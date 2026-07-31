#!/usr/bin/env node
// State-invariant check — zero deps, zero network, no browser.
//
// This repo has no test framework by policy (.brain/HARNESS.md: "Verification =
// invoke the affected command against .brain/ and eyeball the result"). That
// works for output formatting; it does not work for invariants, because the
// whole point of an invariant is that it holds on inputs nobody thought to type
// by hand. Every case below is a shape that USED to pass silently:
// feature_list.json containing `{}`, a duplicate slug, an unknown status, a
// shipped feature with no evidence, a Verdict line without an emoji.
//
// It asserts two layers:
//   1. the pure validators/parsers in lib/state.js, called directly
//   2. brainCheck() against synthetic brains built in a temp dir, so the
//      invariant is proven where `brain check` actually reads it
//
// Run: node scripts/check-state-invariants.mjs   (exit 1 on any failure)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  validateFeatureListShape,
  validateFeatureListStructure,
  oneInProgressEnforced,
  parseVerdict,
  parseVerdictDetail,
  parseReceipt,
  writeFileAtomic,
  STATUSES,
} from "../lib/state.js";
import { brainCheck } from "../lib/review/brain-data.js";

const failures = [];
let assertions = 0;

function ok(label, cond, detail) {
  assertions++;
  if (!cond) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

// A shape validator must REJECT and say why. "Returns some error" is not enough:
// a message that names the wrong field sends the next agent to the wrong place.
function rejects(label, input, expectFragment) {
  const msg = validateFeatureListShape(input);
  assertions++;
  if (msg === null) {
    failures.push(`${label} — expected rejection, got null (accepted as valid)`);
    return;
  }
  if (expectFragment && !msg.includes(expectFragment)) {
    failures.push(`${label} — rejected, but message "${msg}" does not mention "${expectFragment}"`);
  }
}

function accepts(label, input) {
  const msg = validateFeatureListShape(input);
  assertions++;
  if (msg !== null) failures.push(`${label} — expected valid, got "${msg}"`);
}

// ---------------------------------------------------------------------------
// 1. Feature-list schema
// ---------------------------------------------------------------------------

const validFeature = {
  id: "feat-001",
  name: "Thing",
  slug: "thing",
  doc: ".brain/features/thing/thing.md",
  status: "in-progress",
  description: "d",
  dependencies: [],
  evidence: "",
  owners: ["sean"],
};

const validList = {
  updated: "2026-07-31",
  policy: { one_in_progress_at_a_time: true },
  features: [validFeature],
};

accepts("valid list", validList);
accepts("empty features array", { features: [] });
accepts("no policy key", { features: [validFeature] });

// The five non-objects that all used to pass as "feature_list.json parses".
rejects("bare {}", {}, `"features" must be an array`);
rejects("bare []", [], "must be a JSON object");
rejects("a string", "hello", "must be a JSON object");
rejects("a number", 42, "must be a JSON object");
rejects("null", null, "must be a JSON object");
rejects("features as a string", { features: "nope" }, `"features" must be an array`);
rejects("features as an object", { features: {} }, `"features" must be an array`);

rejects("feature is not an object", { features: ["x"] }, "features[0] must be an object");

for (const field of ["id", "name", "slug", "status", "doc"]) {
  const f = { ...validFeature };
  delete f[field];
  rejects(`missing ${field}`, { features: [f] }, `features[0].${field}`);
  rejects(`empty ${field}`, { features: [{ ...validFeature, [field]: "  " }] }, `features[0].${field}`);
}

rejects(
  "unknown status",
  { features: [{ ...validFeature, status: "done" }] },
  `is not one of ${STATUSES.join("|")}`
);
for (const status of STATUSES) {
  const f = { ...validFeature, status, evidence: status === "shipped" ? "proof" : "" };
  accepts(`status ${status} accepted`, { features: [f] });
}

rejects(
  "shipped without evidence",
  { features: [{ ...validFeature, status: "shipped", evidence: "" }] },
  "evidence is required"
);
rejects(
  "shipped with missing evidence key",
  { features: [{ id: "a", name: "n", slug: "s", doc: "d", status: "shipped" }] },
  "evidence is required"
);
accepts("shipped with evidence", {
  features: [{ ...validFeature, status: "shipped", evidence: "verified 2026-07-31" }],
});

rejects(
  "duplicate id",
  { features: [validFeature, { ...validFeature, slug: "other" }] },
  "is not unique"
);
rejects(
  "duplicate slug",
  { features: [validFeature, { ...validFeature, id: "feat-002" }] },
  "is not unique"
);

rejects(
  "dependencies not an array",
  { features: [{ ...validFeature, dependencies: "core" }] },
  "dependencies must be an array"
);
rejects(
  "dependency entry not a string",
  { features: [{ ...validFeature, dependencies: [1] }] },
  "dependencies[0]"
);
rejects(
  "owners entry empty",
  { features: [{ ...validFeature, owners: [""] }] },
  "owners[0]"
);
rejects("policy not an object", { features: [], policy: "yes" }, `"policy" must be an object`);
rejects(
  "policy flag not a boolean",
  { features: [], policy: { one_in_progress_at_a_time: "yes" } },
  "must be a boolean"
);

// ---------------------------------------------------------------------------
// 2. Verdict parsing — both accepted forms, and the gap that hid between them
// ---------------------------------------------------------------------------

ok("emoji PASS", parseVerdict("**Verdict**: ✅ PASS — all good") === "PASS");
ok("emoji FAIL", parseVerdict("**Verdict**: ❌ FAIL — broken") === "FAIL");
ok("emoji BLOCKED", parseVerdict("**Verdict**: ⛔ BLOCKED — no env") === "BLOCKED");

// The regression this whole item exists for: a real doc in a real repo
// (otel-tracing/verifications/2026-07-29.md) that read as `unknown` on every
// display surface while brain check passed it.
ok(
  "bare-word PASS (the otel-tracing case)",
  parseVerdict("**Verdict**: PASS (live smoke against the dev server + 301-test unit suite)") === "PASS",
  `got "${parseVerdict("**Verdict**: PASS (live smoke)")}"`
);
ok("bare-word FAIL", parseVerdict("**Verdict**: FAIL — regression") === "FAIL");
ok("bare-word BLOCKED", parseVerdict("**Verdict**: BLOCKED pending creds") === "BLOCKED");
ok("lowercase word", parseVerdict("**Verdict**: pass") === "PASS");

// Emoji wins when both are present and disagree — the emoji is the form the
// playbook mandates, so it is the more deliberate signal.
ok("emoji beats word", parseVerdict("**Verdict**: ❌ FAIL (not a PASS)") === "FAIL");

const noLine = parseVerdictDetail("# Verification\n\nNo verdict here.");
ok("no Verdict line -> unknown", noLine.verdict === "unknown");
ok("no Verdict line -> hasLine false", noLine.hasLine === false);
ok("no Verdict line -> form none", noLine.form === "none");

const garbage = parseVerdictDetail("**Verdict**: looks fine to me");
ok("unreadable Verdict line -> unknown", garbage.verdict === "unknown");
ok("unreadable Verdict line -> hasLine true", garbage.hasLine === true);

ok("emoji form reported", parseVerdictDetail("**Verdict**: ✅ PASS").form === "emoji");
ok("word form reported", parseVerdictDetail("**Verdict**: PASS").form === "word");
ok("empty input safe", parseVerdict("") === "unknown");
ok("undefined input safe", parseVerdict(undefined) === "unknown");
ok("bullet-prefixed line parses", parseVerdict("- **Verdict**: ✅ PASS") === "PASS");

// --- spoofing. The token must LEAD the value, not merely appear in it. -------
ok(
  "negated verdict is NOT a pass",
  parseVerdict("**Verdict**: this is not PASS") === "unknown",
  `got "${parseVerdict("**Verdict**: this is not PASS")}"`
);
ok("prose mentioning PASS is not a pass", parseVerdict("**Verdict**: we could not PASS the suite") === "unknown");
ok(
  "verdict inside a fenced block does not count",
  parseVerdict("Example:\n\n```\n**Verdict**: ✅ PASS\n```\n") === "unknown",
  `got "${parseVerdict("Example:\n\n```\n**Verdict**: ✅ PASS\n```\n")}"`
);
ok(
  "tilde-fenced block also excluded",
  parseVerdict("~~~\n**Verdict**: ✅ PASS\n~~~\n") === "unknown"
);
ok(
  "a real verdict outside a fence still parses when a fenced example exists",
  parseVerdict("```\n**Verdict**: ✅ PASS\n```\n\n**Verdict**: ❌ FAIL — the real one\n") === "FAIL"
);
{
  const two = parseVerdictDetail("**Verdict**: ✅ PASS\n\n**Verdict**: ❌ FAIL\n");
  ok("two verdict lines are ambiguous, not first-wins", two.verdict === "unknown", two.verdict);
  ok("ambiguous form reported", two.form === "ambiguous", two.form);
}
{
  const conflict = parseVerdictDetail("**Verdict**: ✅ FAIL");
  ok("emoji contradicting its word is ambiguous", conflict.verdict === "unknown", conflict.verdict);
  ok("conflicting form reported", conflict.form === "conflicting", conflict.form);
}

// Spoofs found by an independent adversarial review — each scored as a clean
// PASS before being closed.
ok(
  "4-space indented code block is not a verdict",
  parseVerdict("Example:\n\n    **Verdict**: ✅ PASS\n\ndone") === "unknown",
  `got "${parseVerdict("Example:\n\n    **Verdict**: ✅ PASS\n")}"`
);
ok(
  "an UNCLOSED fence swallows the rest of the doc",
  parseVerdict("```\n**Verdict**: ✅ PASS") === "unknown",
  `got "${parseVerdict("```\n**Verdict**: ✅ PASS")}"`
);
ok(
  "a TRAILING contradicting emoji is conflicting",
  parseVerdict("**Verdict**: ✅ PASS ❌") === "unknown",
  `got "${parseVerdict("**Verdict**: ✅ PASS ❌")}"`
);
ok(
  "restating the SAME verdict is not ambiguous",
  parseVerdict("**Verdict**: ✅ PASS\n\nsummary\n\n**Verdict**: ✅ PASS") === "PASS",
  "a doc that repeats its verdict in a summary should still parse"
);
ok(
  "three-space indent still parses (not a code block)",
  parseVerdict("   **Verdict**: ✅ PASS") === "PASS"
);

// --- structure vs full validation: repair must stay possible ----------------
{
  const legacy = { features: [{ ...validFeature, status: "shipped", evidence: "" }] };
  ok(
    "a legacy shipped-without-evidence record is a FULL-shape failure",
    validateFeatureListShape(legacy) !== null
  );
  ok(
    "...but NOT a structure failure, so the CLI can still repair it",
    validateFeatureListStructure(legacy) === null,
    "structure validation rejected a repairable record — set-status would be locked out"
  );
  ok("structure rejects a non-array features", validateFeatureListStructure({ features: 1 }) !== null);
  ok("structure rejects a non-object entry", validateFeatureListStructure({ features: ["x"] }) !== null);
  ok("structure rejects a non-object root", validateFeatureListStructure([]) !== null);
}

// --- one-in-progress policy: ONE definition for setter and checker ----------
ok("absent policy enforces", oneInProgressEnforced({ features: [] }) === true);
ok("policy true enforces", oneInProgressEnforced({ policy: { one_in_progress_at_a_time: true } }) === true);
ok("explicit false opts out", oneInProgressEnforced({ policy: { one_in_progress_at_a_time: false } }) === false);
ok("empty policy object enforces", oneInProgressEnforced({ policy: {} }) === true);
ok("null list enforces", oneInProgressEnforced(null) === true);

// ---------------------------------------------------------------------------
// 3. Atomic write
// ---------------------------------------------------------------------------

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brain-state-check-"));

{
  const target = path.join(tmpRoot, "nested", "out.json");
  writeFileAtomic(target, '{"a":1}\n');
  ok("atomic write creates the file", fs.readFileSync(target, "utf8") === '{"a":1}\n');
  ok("atomic write creates missing dirs", fs.existsSync(path.dirname(target)));
  const leftovers = fs.readdirSync(path.dirname(target)).filter((f) => f.includes(".tmp-"));
  ok("no temp file left behind", leftovers.length === 0, leftovers.join(", "));

  writeFileAtomic(target, '{"a":2}\n');
  ok("atomic write overwrites", fs.readFileSync(target, "utf8") === '{"a":2}\n');
}

// ---------------------------------------------------------------------------
// 4. brainCheck against synthetic brains — the invariant where it is read
// ---------------------------------------------------------------------------

function makeBrain(name, featureList, { verdictDoc } = {}) {
  const brain = path.join(tmpRoot, name, ".brain");
  fs.mkdirSync(path.join(brain, "features"), { recursive: true });
  fs.mkdirSync(path.join(brain, "runs"), { recursive: true });
  fs.writeFileSync(path.join(brain, "runs", "progress.md"), "# Progress\n\n---\n");
  fs.writeFileSync(
    path.join(brain, "features", "feature_list.json"),
    JSON.stringify(featureList, null, 2) + "\n"
  );
  for (const f of Array.isArray(featureList.features) ? featureList.features : []) {
    const dir = path.join(brain, "features", f.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${f.slug}.md`), `# ${f.name}\n`);
    if (verdictDoc) {
      const vdir = path.join(dir, "verifications");
      fs.mkdirSync(vdir, { recursive: true });
      fs.writeFileSync(path.join(vdir, "2026-07-31.md"), verdictDoc);
    }
  }
  return brain;
}

function checkNamed(brain, name) {
  const rows = brainCheck(brain);
  const row = rows.find((r) => r.check === name);
  return row || { check: name, status: "MISSING", detail: "no such check row" };
}

function featureFor(slug, over = {}) {
  return {
    id: `id-${slug}`,
    name: slug,
    slug,
    doc: `.brain/features/${slug}/${slug}.md`,
    status: "planned",
    dependencies: [],
    evidence: "",
    owners: ["sean"],
    ...over,
  };
}

const SCHEMA_CHECK = "feature_list.json is valid";

{
  const brain = makeBrain("clean", { updated: "2026-07-31", features: [featureFor("alpha")] });
  const row = checkNamed(brain, SCHEMA_CHECK);
  ok(`clean brain passes "${SCHEMA_CHECK}"`, row.status === "pass", `${row.status}: ${row.detail}`);
  const failed = brainCheck(brain).filter((r) => r.status === "fail");
  ok("clean brain has zero failing checks", failed.length === 0, failed.map((r) => r.check).join(", "));
}

{
  // The headline case: valid JSON, invalid state.
  const brain = makeBrain("dupslug", {
    features: [featureFor("alpha"), { ...featureFor("alpha"), id: "id-2" }],
  });
  const row = checkNamed(brain, SCHEMA_CHECK);
  ok("duplicate slug fails the schema check", row.status === "fail", `${row.status}: ${row.detail}`);
  ok("duplicate slug detail names uniqueness", /not unique/.test(row.detail || ""), row.detail);
}

{
  const brain = makeBrain("badstatus", { features: [featureFor("alpha", { status: "done" })] });
  const row = checkNamed(brain, SCHEMA_CHECK);
  ok("unknown status fails the schema check", row.status === "fail", `${row.status}: ${row.detail}`);
}

{
  const brain = makeBrain("shipped-no-evidence", {
    features: [featureFor("alpha", { status: "shipped", evidence: "" })],
  });
  const row = checkNamed(brain, SCHEMA_CHECK);
  ok("shipped without evidence fails the schema check", row.status === "fail", `${row.status}: ${row.detail}`);
}

{
  const brain = path.join(tmpRoot, "emptyobj", ".brain");
  fs.mkdirSync(path.join(brain, "features"), { recursive: true });
  fs.mkdirSync(path.join(brain, "runs"), { recursive: true });
  fs.writeFileSync(path.join(brain, "runs", "progress.md"), "# Progress\n\n---\n");
  fs.writeFileSync(path.join(brain, "features", "feature_list.json"), "{}\n");
  const row = checkNamed(brain, SCHEMA_CHECK);
  ok("bare {} fails the schema check", row.status === "fail", `${row.status}: ${row.detail}`);
}

{
  // Two features in-progress must fail regardless of whether `policy` is
  // present — brainCheck used to hardcode the invariant while
  // `features set-status` consulted policy, so the two disagreed.
  const brain = makeBrain("two-inprogress", {
    features: [
      featureFor("alpha", { status: "in-progress" }),
      featureFor("beta", { status: "in-progress" }),
    ],
  });
  const row = checkNamed(brain, "at most one feature in-progress");
  ok("two in-progress fails", row.status === "fail", `${row.status}: ${row.detail}`);
}

{
  // Verdict docs: both forms must reach the same conclusion in brainCheck.
  const word = makeBrain("verdict-word", { features: [featureFor("alpha")] }, {
    verdictDoc: "# V\n\n**Verdict**: PASS (bare word)\n",
  });
  const emoji = makeBrain("verdict-emoji", { features: [featureFor("beta")] }, {
    verdictDoc: "# V\n\n**Verdict**: ✅ PASS\n",
  });
  const wordRow = brainCheck(word).find((r) => /Verdict/.test(r.check));
  const emojiRow = brainCheck(emoji).find((r) => /Verdict/.test(r.check));
  ok("bare-word verdict doc passes brainCheck", wordRow && wordRow.status === "pass",
    wordRow && `${wordRow.status}: ${wordRow.detail}`);
  ok("emoji verdict doc passes brainCheck", emojiRow && emojiRow.status === "pass",
    emojiRow && `${emojiRow.status}: ${emojiRow.detail}`);

  const unreadable = makeBrain("verdict-bad", { features: [featureFor("gamma")] }, {
    verdictDoc: "# V\n\n**Verdict**: looks fine\n",
  });
  const badRow = brainCheck(unreadable).find((r) => /Verdict/.test(r.check));
  ok("unreadable verdict fails brainCheck", badRow && badRow.status === "fail",
    badRow && `${badRow.status}: ${badRow.detail}`);
}

{
  // Image links in verdict docs. Without a NEGATIVE fixture this check is
  // theater: every real verdict doc happens to contain no markdown images, so
  // the green row proves nothing.
  const good = makeBrain("shots-ok", { features: [featureFor("alpha")] }, {
    verdictDoc: "# V\n\n**Verdict**: ✅ PASS\n\n![step](../screenshots/01-a.png)\n",
  });
  fs.mkdirSync(path.join(good, "features", "alpha", "screenshots"), { recursive: true });
  fs.writeFileSync(path.join(good, "features", "alpha", "screenshots", "01-a.png"), "x");
  const goodRow = brainCheck(good).find((r) => r.check === "verification doc image links resolve");
  ok("resolvable image link passes", goodRow && goodRow.status === "pass",
    goodRow && `${goodRow.status}: ${goodRow.detail}`);

  const bad = makeBrain("shots-missing", { features: [featureFor("beta")] }, {
    verdictDoc: "# V\n\n**Verdict**: ✅ PASS\n\n![step](../screenshots/99-nope.png)\n",
  });
  const badRow = brainCheck(bad).find((r) => r.check === "verification doc image links resolve");
  ok("dangling image link FAILS", badRow && badRow.status === "fail",
    badRow && `${badRow.status}: ${badRow.detail}`);
  ok("dangling image detail names the target", badRow && /99-nope\.png/.test(badRow.detail || ""),
    badRow && badRow.detail);
}

{
  // index.md drift — the defect that was live in both real repos.
  const brain = makeBrain("index-drift", {
    features: [featureFor("alpha", { status: "shipped", evidence: "proof" })],
  });
  fs.writeFileSync(
    path.join(brain, "features", "index.md"),
    "| Feature | File | Status |\n|---|---|---|\n| Alpha | [`alpha/alpha.md`](alpha/alpha.md) | in-progress |\n"
  );
  const row = brainCheck(brain).find((r) => r.check === "features/index.md agrees with the tracker");
  ok("index drift FAILS", row && row.status === "fail", row && `${row.status}: ${row.detail}`);
  ok("index drift names both values", row && /shipped/.test(row.detail) && /in-progress/.test(row.detail),
    row && row.detail);

  // And agreeing is a pass, so the check is not simply always-red.
  fs.writeFileSync(
    path.join(brain, "features", "index.md"),
    "| Feature | File | Status |\n|---|---|---|\n| Alpha | [`alpha/alpha.md`](alpha/alpha.md) | shipped |\n"
  );
  const okRow = brainCheck(brain).find((r) => r.check === "features/index.md agrees with the tracker");
  ok("index agreement passes", okRow && okRow.status === "pass", okRow && `${okRow.status}: ${okRow.detail}`);
}

{
  // Drift-check holes found by the same independent review: one false positive
  // and four false negatives, each of which let real drift pass.
  const brain = makeBrain("index-edge", {
    features: [
      featureFor("alpha", { status: "shipped", evidence: "proof" }),
      featureFor("beta", { status: "planned" }),
    ],
  });
  const idx = path.join(brain, "features", "index.md");
  const driftRow = () =>
    brainCheck(brain).find((r) => r.check === "features/index.md agrees with the tracker");

  const HEAD = "| Feature | File | Status |\n|---|---|---|\n";
  const betaOk = "| Beta | [`beta/beta.md`](beta/beta.md) | planned |\n";

  // False positive: prose with a pipe + a doc link + one status word.
  fs.writeFileSync(
    idx,
    HEAD +
      "| Alpha | [`alpha/alpha.md`](alpha/alpha.md) | shipped |\n" +
      betaOk +
      "\nNote: the pipeline was **blocked** by CI, see [`alpha/alpha.md`](alpha/alpha.md)\n"
  );
  ok("prose line is not judged as a status row", driftRow()?.status === "pass", driftRow()?.detail);

  // False negative 1: capitalized status.
  fs.writeFileSync(idx, HEAD + "| Alpha | [`alpha/alpha.md`](alpha/alpha.md) | Planned |\n" + betaOk);
  ok("capitalized status is still compared", driftRow()?.status === "fail", driftRow()?.detail);

  // False negative 2: two status words in one row.
  fs.writeFileSync(
    idx,
    HEAD + "| Alpha | [`alpha/alpha.md`](alpha/alpha.md) | was in-progress, now shipped |\n" + betaOk
  );
  ok("row with two status words is unverifiable, not a pass", driftRow()?.status === "fail", driftRow()?.detail);

  // False negative 3: one row links two features, drift on the second.
  fs.writeFileSync(
    idx,
    HEAD + "| Both | [`alpha/alpha.md`](alpha/alpha.md) [`beta/beta.md`](beta/beta.md) | shipped |\n"
  );
  ok("every linked feature in a row is attributed", driftRow()?.status === "fail", driftRow()?.detail);

  // False negative 4: a tracker feature missing from the index entirely.
  fs.writeFileSync(idx, HEAD + "| Alpha | [`alpha/alpha.md`](alpha/alpha.md) | shipped |\n");
  const missing = driftRow();
  ok("a feature absent from index.md is reported", missing?.status === "fail", missing?.detail);
  ok("...and names the missing slug", /beta/.test(missing?.detail || ""), missing?.detail);
}

{
  // shipped ⇒ PASS verification. Opt-in for ambient `brain check`, always on at
  // the ship gate — so both behaviors need pinning.
  const noDoc = makeBrain("strict-nodoc", {
    features: [featureFor("alpha", { status: "shipped", evidence: "trust me" })],
  });
  const lenient = brainCheck(noDoc).find((r) => /PASS verification/.test(r.check));
  ok("shipped-without-proof is INVISIBLE without --strict", lenient === undefined,
    "the invariant must stay opt-in so existing brains do not go red on upgrade");
  const strict = brainCheck(noDoc, { strict: true }).find((r) => /PASS verification/.test(r.check));
  ok("shipped-without-proof FAILS under strict", strict && strict.status === "fail",
    strict && `${strict.status}: ${strict.detail}`);
  ok("strict detail names the unproven slug", strict && /alpha/.test(strict.detail || ""), strict?.detail);

  const withPass = makeBrain(
    "strict-pass",
    { features: [featureFor("beta", { status: "shipped", evidence: "verified" })] },
    { verdictDoc: "# V\n\n**Verdict**: ✅ PASS\n" }
  );
  const passRow = brainCheck(withPass, { strict: true }).find((r) => /PASS verification/.test(r.check));
  ok("shipped WITH a PASS doc passes strict", passRow && passRow.status === "pass",
    passRow && `${passRow.status}: ${passRow.detail}`);

  // A FAIL verdict is not proof of shipping — the doc existing is not the point.
  const withFail = makeBrain(
    "strict-fail",
    { features: [featureFor("gamma", { status: "shipped", evidence: "verified" })] },
    { verdictDoc: "# V\n\n**Verdict**: ❌ FAIL\n" }
  );
  const failRow = brainCheck(withFail, { strict: true }).find((r) => /PASS verification/.test(r.check));
  ok("a FAIL verdict does not satisfy shipped", failRow && failRow.status === "fail",
    failRow && `${failRow.status}: ${failRow.detail}`);
  ok("...and says the docs exist but none PASS", failRow && /none PASS/.test(failRow.detail || ""),
    failRow?.detail);
}

{
  // Receipts. A PASS with no commit is unfalsifiable — the doc is a mutable,
  // date-named markdown file, so "it passed" could describe any tree that ever
  // existed. These fixtures need a REAL git repo, because the cases that matter
  // are provenance ones.
  const RECEIPT_ROW = "every PASS verification is bound to a commit";
  const repo = path.join(tmpRoot, "receipt-repo");
  fs.mkdirSync(repo, { recursive: true });
  const g = (...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  g("init", "-q");
  g("config", "user.email", "fixture@example.com");
  g("config", "user.name", "Fixture");
  fs.writeFileSync(path.join(repo, "a.txt"), "1\n");
  g("add", "-A");
  g("commit", "-qm", "one");
  const realSha = (g("rev-parse", "--short", "HEAD").stdout || "").trim();
  // Capture the branch by NAME: `checkout -` does not reliably return from an
  // orphan branch, and getting this wrong silently inverts both assertions below.
  const mainBranch = (g("rev-parse", "--abbrev-ref", "HEAD").stdout || "").trim();

  // An orphan commit: a real object reachable from no branch HEAD can see — i.e.
  // a verdict taken on code that never landed.
  g("checkout", "-q", "--orphan", "sidebranch");
  fs.writeFileSync(path.join(repo, "b.txt"), "2\n");
  g("add", "-A");
  g("commit", "-qm", "orphan");
  const orphanSha = (g("rev-parse", "--short", "HEAD").stdout || "").trim();
  g("checkout", "-q", mainBranch);
  ok(
    "fixture repo is back on the original branch",
    (g("rev-parse", "--short", "HEAD").stdout || "").trim() === realSha,
    "HEAD is not the first commit — the ancestor assertions below would be inverted"
  );

  ok("fixture repo produced a real sha", /^[0-9a-f]{7,}$/.test(realSha), realSha);
  ok("fixture repo produced an orphan sha", /^[0-9a-f]{7,}$/.test(orphanSha), orphanSha);

  function receiptBrain(name, receiptLines) {
    const brain = path.join(repo, name, ".brain");
    fs.mkdirSync(path.join(brain, "features", "alpha", "verifications"), { recursive: true });
    fs.mkdirSync(path.join(brain, "runs"), { recursive: true });
    fs.writeFileSync(path.join(brain, "runs", "progress.md"), "# Progress\n\n---\n");
    fs.writeFileSync(
      path.join(brain, "features", "feature_list.json"),
      JSON.stringify(
        { features: [featureFor("alpha", { status: "shipped", evidence: "proof" })] },
        null,
        2
      ) + "\n"
    );
    fs.writeFileSync(path.join(brain, "features", "alpha", "alpha.md"), "# alpha\n");
    fs.writeFileSync(
      path.join(brain, "features", "alpha", "verifications", "2026-07-31.md"),
      `# V\n\n**Verdict**: ✅ PASS\n\n${receiptLines}\n`
    );
    return brain;
  }

  const rowOf = (brain) => brainCheck(brain, { strict: true }).find((r) => r.check === RECEIPT_ROW);

  const noReceipt = receiptBrain("no-receipt", "");
  ok("PASS with no receipt fails strict", rowOf(noReceipt)?.status === "fail", rowOf(noReceipt)?.detail);
  ok(
    "...and says the receipt is missing",
    /no brain:verification receipt/.test(rowOf(noReceipt)?.detail || ""),
    rowOf(noReceipt)?.detail
  );

  const noCommit = receiptBrain("no-commit", "<!-- brain:verification\nverified_by: fixture\n-->");
  ok("receipt without a commit fails", rowOf(noCommit)?.status === "fail", rowOf(noCommit)?.detail);

  const bogus = receiptBrain(
    "bogus-commit",
    "<!-- brain:verification\ncommit: deadbeef\nverified_by: fixture\n-->"
  );
  ok("receipt naming a commit not in the repo fails", rowOf(bogus)?.status === "fail", rowOf(bogus)?.detail);

  const orphan = receiptBrain(
    "orphan-commit",
    `<!-- brain:verification\ncommit: ${orphanSha}\nverified_by: fixture\n-->`
  );
  const orphanRow = rowOf(orphan);
  ok("receipt on a commit that never landed fails", orphanRow?.status === "fail", orphanRow?.detail);
  ok("...and says it is not an ancestor", /not an ancestor/.test(orphanRow?.detail || ""), orphanRow?.detail);

  const good = receiptBrain(
    "good-commit",
    `<!-- brain:verification\ncommit: ${realSha}\nverified_by: fixture\n-->`
  );
  ok("receipt on an ancestor of HEAD passes", rowOf(good)?.status === "pass", rowOf(good)?.detail);

  const r = parseReceipt("<!-- brain:verification\ncommit: abc1234\nverified_by: x\ncommands: a; b\n-->");
  ok("receipt commit parsed", r.commit === "abc1234", r.commit);
  ok("receipt verified_by parsed", r.verified_by === "x", r.verified_by);
  ok("receipt commands parsed", r.commands === "a; b", r.commands);
  ok("absent receipt is not an error", parseReceipt("nothing here").present === false);
}

// ---------------------------------------------------------------------------
// 5. ship is preflight-then-commit — the CLI, invoked as a subprocess
//
// The regression: ship used to write feature_list.json AND append a progress
// checkpoint, THEN run brainCheck, then exit 1 with the flip already on disk.
// The only honest proof is byte-comparing the files around a refused ship.
// ---------------------------------------------------------------------------


// A PASS verdict doc that also satisfies the strict receipt gate. Temp brains are
// not git repos, so receipt PRESENCE is the ceiling there — provenance is checked
// against a real repo in the receipt section below.
const PASS_DOC =
  "# V\n\n**Verdict**: \u2705 PASS\n\n<!-- brain:verification\ncommit: abc1234\nverified_by: fixture\n-->\n";

const CLI = path.resolve(new URL("../bin/brain.js", import.meta.url).pathname);

function shipAgainst(brain, slug) {
  const res = spawnSync(
    process.execPath,
    [CLI, "ship", slug, "--evidence", "synthetic evidence for the invariant check", "--brain", brain],
    { encoding: "utf8" }
  );
  return { status: res.status, out: (res.stdout || "") + (res.stderr || "") };
}

{
  // A brain that is coherent EXCEPT for a dangling dependency ref, so
  // brainCheck fails for a reason unrelated to the feature being shipped.
  const brain = makeBrain(
    "ship-refuse",
    {
      updated: "2026-07-31",
      policy: { one_in_progress_at_a_time: true },
      features: [
        featureFor("alpha", { status: "in-progress", dependencies: ["ghost"] }),
      ],
    },
    { verdictDoc: PASS_DOC }
  );
  const flPath = path.join(brain, "features", "feature_list.json");
  const progressPath = path.join(brain, "runs", "progress.md");
  const beforeFl = fs.readFileSync(flPath, "utf8");
  const beforeProgress = fs.readFileSync(progressPath, "utf8");

  const { status, out } = shipAgainst(brain, "alpha");

  ok("refused ship exits non-zero", status === 1, `exit ${status}`);
  ok("refused ship says refused", /refused/.test(out), out.split("\n")[0]);
  ok(
    "refused ship leaves feature_list.json byte-identical",
    fs.readFileSync(flPath, "utf8") === beforeFl,
    "feature_list.json was modified by a refused ship"
  );
  ok(
    "refused ship leaves progress.md byte-identical",
    fs.readFileSync(progressPath, "utf8") === beforeProgress,
    "progress.md was modified by a refused ship"
  );
  ok(
    "refused ship did not flip status on disk",
    JSON.parse(fs.readFileSync(flPath, "utf8")).features[0].status === "in-progress"
  );
}

{
  // The happy path still ships, so the guard is not simply refusing everything.
  const brain = makeBrain(
    "ship-accept",
    {
      updated: "2026-07-31",
      policy: { one_in_progress_at_a_time: true },
      features: [featureFor("alpha", { status: "in-progress" })],
    },
    { verdictDoc: PASS_DOC }
  );
  const flPath = path.join(brain, "features", "feature_list.json");
  const { status, out } = shipAgainst(brain, "alpha");
  ok("clean ship exits 0", status === 0, `exit ${status}: ${out.split("\n")[0]}`);
  const after = JSON.parse(fs.readFileSync(flPath, "utf8")).features[0];
  ok("clean ship flips status", after.status === "shipped", after.status);
  ok("clean ship records evidence", /synthetic evidence/.test(after.evidence || ""), after.evidence);
  ok("clean ship leaves no temp file", fs.readdirSync(path.dirname(flPath)).every((f) => !f.includes(".tmp-")));
}

{
  // The bypass: `features set-status --status shipped` used to write shipped
  // state with no brainCheck at all, so hardening `ship` alone moved the hole
  // rather than closing it.
  const brain = makeBrain(
    "setstatus-bypass",
    { features: [featureFor("alpha", { status: "in-progress", dependencies: ["ghost"] })] },
    { verdictDoc: PASS_DOC }
  );
  const flPath = path.join(brain, "features", "feature_list.json");
  const before = fs.readFileSync(flPath, "utf8");
  const res = spawnSync(
    process.execPath,
    [CLI, "features", "set-status", "alpha", "--status", "shipped", "--evidence", "bypass attempt", "--brain", brain],
    { encoding: "utf8" }
  );
  ok("set-status shipped is gated too", res.status === 1, `exit ${res.status}`);
  ok(
    "refused set-status leaves feature_list.json byte-identical",
    fs.readFileSync(flPath, "utf8") === before
  );

  // De-escalation stays UNGATED on purpose: gating it would lock the operator
  // out of repairing the very records that make a brain incoherent.
  const down = spawnSync(
    process.execPath,
    [CLI, "features", "set-status", "alpha", "--status", "blocked", "--brain", brain],
    { encoding: "utf8" }
  );
  ok("de-escalation is not blocked by a failing brain", down.status === 0,
    `exit ${down.status}: ${(down.stdout || "").split("\n")[0]}`);
}

{
  // init --state-only: the clone case. A repo cloned from a template inherits
  // the TEMPLATE's features, cursor, and run notes — context drift shipped as a
  // default. Docs must survive (the clone inherits the stack along with the
  // code); state must not (it is another project's history).
  const root = path.join(tmpRoot, "cloned-repo");
  const brain = path.join(root, ".brain");
  fs.mkdirSync(path.join(brain, "features", "inherited"), { recursive: true });
  fs.mkdirSync(path.join(brain, "runs"), { recursive: true });
  fs.mkdirSync(path.join(brain, "plans", "old-plan"), { recursive: true });
  fs.mkdirSync(path.join(brain, "rules"), { recursive: true });
  fs.mkdirSync(path.join(brain, "recipes"), { recursive: true });
  fs.writeFileSync(path.join(brain, "HARNESS.md"), "# harness\n");
  fs.writeFileSync(path.join(brain, "rules", "frontend.md"), "# stack rule\n");
  fs.writeFileSync(path.join(brain, "recipes", "add-thing.md"), "# recipe\n");
  fs.writeFileSync(
    path.join(brain, "runs", "progress.md"),
    "# Progress\n\n---\n\n## 2020-01-01 — someone else's release\n"
  );
  fs.writeFileSync(path.join(brain, "features", "inherited", "inherited.md"), "# inherited\n");
  fs.writeFileSync(
    path.join(brain, "features", "feature_list.json"),
    JSON.stringify(
      { features: [featureFor("inherited", { status: "shipped", evidence: "theirs" })] },
      null,
      2
    ) + "\n"
  );

  const res = spawnSync(process.execPath, [CLI, "init", "--state-only", "--dir", root, "--yes"], {
    encoding: "utf8",
  });
  ok("init --state-only exits 0", res.status === 0, `exit ${res.status}: ${(res.stdout || "").slice(0, 200)}`);

  const list = JSON.parse(fs.readFileSync(path.join(brain, "features", "feature_list.json"), "utf8"));
  ok(
    "inherited features are gone",
    Array.isArray(list.features) && list.features.length === 0,
    JSON.stringify(list.features)
  );
  ok("inherited feature folder is gone", !fs.existsSync(path.join(brain, "features", "inherited")));
  ok("inherited plans are gone", !fs.existsSync(path.join(brain, "plans", "old-plan")));
  const progress = fs.readFileSync(path.join(brain, "runs", "progress.md"), "utf8");
  ok("cursor no longer holds another project's history", !/someone else/.test(progress));
  ok("cursor has a fresh first checkpoint", /brain init/.test(progress), progress.slice(0, 120));

  // The half that must SURVIVE — wiping these forces every clone to re-derive
  // the stack conventions it inherited along with the code.
  ok("stack rules kept", fs.existsSync(path.join(brain, "rules", "frontend.md")));
  ok("recipes kept", fs.existsSync(path.join(brain, "recipes", "add-thing.md")));
  ok("HARNESS.md kept", fs.existsSync(path.join(brain, "HARNESS.md")));

  // A reset brain must be coherent, not merely empty.
  const after = spawnSync(process.execPath, [CLI, "check", "--brain", brain], { encoding: "utf8" });
  ok("a reset brain passes brain check", after.status === 0, (after.stdout || "").slice(0, 300));

  // Refuses on an absent brain rather than silently scaffolding one.
  const empty = path.join(tmpRoot, "not-a-brain");
  fs.mkdirSync(empty, { recursive: true });
  const noBrain = spawnSync(process.execPath, [CLI, "init", "--state-only", "--dir", empty, "--yes"], {
    encoding: "utf8",
  });
  ok("init --state-only refuses when there is no brain", noBrain.status === 1, `exit ${noBrain.status}`);
}


fs.rmSync(tmpRoot, { recursive: true, force: true });

// ---------------------------------------------------------------------------

if (failures.length) {
  console.error(`state-invariants: ${failures.length} failure(s) of ${assertions} assertion(s)`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`state-invariants: ok — ${assertions} assertions (schema, verdict parsing, atomic write, brainCheck)`);
