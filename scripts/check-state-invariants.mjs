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
  parseIndependence,
  sameIdentity,
  writeFileAtomic,
  STATUSES,
  SUMMARY_MAX_CHARS,
  TASK_STATUSES,
  validateTasksShape,
  unblockedTasks,
  tasksPath,
  readTasks,
  writeTasksCas,
} from "../lib/state.js";
import { brainCheck, healthChecks, listVerifications } from "../lib/review/brain-data.js";

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

// Same two helpers, for tasks.json. A validator that names the wrong field
// sends the next agent to the wrong task — same reasoning as `rejects` above.
function rejectsTasks(label, input, expectFragment, slug) {
  const msg = validateTasksShape(input, slug);
  assertions++;
  if (msg === null) {
    failures.push(`${label} — expected rejection, got null (accepted as valid)`);
    return;
  }
  if (expectFragment && !msg.includes(expectFragment)) {
    failures.push(`${label} — rejected, but message "${msg}" does not mention "${expectFragment}"`);
  }
}

function acceptsTasks(label, input, slug) {
  const msg = validateTasksShape(input, slug);
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
  const leftovers = fs.readdirSync(path.dirname(target)).filter((f) => f.includes(".tmp-"));
  ok("no temp file left behind", leftovers.length === 0, leftovers.join(", "));

  writeFileAtomic(target, '{"a":2}\n');
  ok("atomic write overwrites", fs.readFileSync(target, "utf8") === '{"a":2}\n');
}

// The four assertions above pass verbatim if writeFileAtomic is replaced with a
// plain fs.writeFileSync — they describe writeFileSync's contract, not
// atomicity, while rules/state.md advertises this section as proving the atomic
// path. Below are the assertions that actually discriminate. Each one FAILS
// against a naive mkdirSync+writeFileSync implementation; that is the only
// property that makes them worth the lines.
{
  const target = path.join(tmpRoot, "atomic", "swap.json");
  writeFileAtomic(target, "old content\n");
  fs.chmodSync(target, 0o600);

  // 1. REPLACE, don't truncate-in-place. rename(2) swaps the directory entry to
  //    a different inode; writeFileSync reuses the same one. This is the whole
  //    reason a concurrent reader never observes a half-written file.
  const beforeIno = fs.statSync(target).ino;

  // 2. A reader holding the file open across the write keeps seeing the OLD
  //    bytes, complete and consistent — never a truncated prefix of the new
  //    ones. Under writeFileSync this fd observes the new (or partial) content.
  const heldFd = fs.openSync(target, "r");

  writeFileAtomic(target, "new content, materially longer than the old\n");

  const afterIno = fs.statSync(target).ino;
  ok(
    "atomic write swaps the inode (rename, not truncate-in-place)",
    beforeIno !== afterIno,
    `inode unchanged (${beforeIno}) — this is writeFileSync behavior, not rename`
  );

  const viaHeldFd = fs.readFileSync(heldFd, "utf8");
  fs.closeSync(heldFd);
  ok(
    "a reader open across the write still sees the whole OLD file",
    viaHeldFd === "old content\n",
    `held fd saw ${JSON.stringify(viaHeldFd)}`
  );

  // 3. Mode survives. The temp file is created fresh, so without an explicit
  //    copy the target silently reverts to the default 0644 — a 0600 file would
  //    be widened by the act of writing it.
  ok(
    "atomic write preserves the target's mode",
    (fs.statSync(target).mode & 0o777) === 0o600,
    `mode is ${(fs.statSync(target).mode & 0o777).toString(8)}, expected 600`
  );

  ok("atomic write landed the new content", fs.readFileSync(target, "utf8").startsWith("new content"));

  // 4. A fresh file in a directory that does not exist yet still lands, and
  //    leaves no temp behind. (Separate from the mode case: nothing to inherit.)
  const deep = path.join(tmpRoot, "atomic", "a", "b", "c.json");
  writeFileAtomic(deep, "deep\n");
  ok("atomic write creates missing dirs", fs.readFileSync(deep, "utf8") === "deep\n");
  ok(
    "no temp file left behind in a freshly created dir",
    fs.readdirSync(path.dirname(deep)).every((f) => !f.includes(".tmp-"))
  );
}

// ---------------------------------------------------------------------------
// 4. brainCheck against synthetic brains — the invariant where it is read
// ---------------------------------------------------------------------------

function makeBrain(name, featureList, opts = {}) {
  const { verdictDoc } = opts;
  const brain = path.join(tmpRoot, name, ".brain");
  fs.mkdirSync(path.join(brain, "features"), { recursive: true });
  fs.mkdirSync(path.join(brain, "runs"), { recursive: true });
  fs.writeFileSync(path.join(brain, "runs", "progress.md"), "# Progress\n\n---\n");
  fs.writeFileSync(
    path.join(brain, "features", "feature_list.json"),
    JSON.stringify(featureList, null, 2) + "\n"
  );
  // Write a GENERATED index by default. Fixtures without one are why a ship
  // deadlock in indexed brains went unnoticed: no test ever exercised the shape
  // every real brain has. Pass {noIndex:true} to test its absence deliberately.
  if (!opts.noIndex && Array.isArray(featureList.features) && featureList.features.length) {
    const rows = featureList.features.map(
      (f) => `| ${f.name} | [\`${f.slug}/${f.slug}.md\`](${f.slug}/${f.slug}.md) | ${f.status} | — |`
    );
    fs.writeFileSync(
      path.join(brain, "features", "index.md"),
      [
        "# Features",
        "",
        "<!-- brain:features-table -->",
        "| Feature | Memo | Status | Latest verification |",
        "|---------|------|--------|---------------------|",
        ...rows,
        "<!-- /brain:features-table -->",
        "",
      ].join("\n")
    );
  }

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

  // Verifier independence — the evaluator must not be the generator. Never a
  // fail (solo work is real; legacy receipts predate the field), so every case
  // below must also leave the run's fail set empty.
  const IND_ROW = "every shipped feature was verified independently";
  const indOf = (brain) => brainCheck(brain, { strict: true }).find((row) => row.check === IND_ROW);
  const failsOf = (brain) => brainCheck(brain, { strict: true }).filter((row) => row.status === "fail");

  ok("receipt implemented_by parsed",
    parseReceipt("<!-- brain:verification\ncommit: abc1234\nverified_by: v\nimplemented_by: builder\n-->")
      .implemented_by === "builder");
  ok("legacy receipt parses with implemented_by null", r.present && r.implemented_by === null, String(r.implemented_by));
  ok("legacy receipt parses with both identity sources null",
    r.verified_by_source === null && r.implemented_by_source === null,
    `${r.verified_by_source}/${r.implemented_by_source}`);
  const srcR = parseReceipt(
    "<!-- brain:verification\ncommit: abc1234\nverified_by: v\nimplemented_by: b\nverified_by_source: flag\nimplemented_by_source: Default\n-->"
  );
  ok("receipt identity sources parsed (lowercased)",
    srcR.verified_by_source === "flag" && srcR.implemented_by_source === "default",
    `${srcR.verified_by_source}/${srcR.implemented_by_source}`);
  ok("sameIdentity is case-insensitive and trimmed", sameIdentity(" Sean ", "sean"));
  ok("sameIdentity: two blanks are NOT the same identity", !sameIdentity("", null));
  ok("sameIdentity: different names differ", !sameIdentity("builder", "verifier"));

  // Legacy (no implemented_by) — judged nothing, so skip, never fail.
  const legacyRow = indOf(good);
  ok("legacy receipt (no implemented_by) does not fail independence",
    legacyRow && legacyRow.status !== "fail" && legacyRow.status !== "warn", legacyRow && `${legacyRow.status}: ${legacyRow.detail}`);
  ok("...and names it as predating implemented_by", /predate implemented_by: alpha/.test(legacyRow?.detail || ""), legacyRow?.detail);

  const indep = receiptBrain(
    "independent",
    `<!-- brain:verification\ncommit: ${realSha}\nverified_by: verifier-agent\nimplemented_by: builder-agent\n-->`
  );
  ok("distinct implemented_by/verified_by passes independence", indOf(indep)?.status === "pass", indOf(indep)?.detail);

  // A receipt with implemented_by but no verified_by names no verifier — a
  // blank must not read as "different from the implementer" and pass.
  const unnamedVerifier = receiptBrain(
    "unnamed-verifier",
    `<!-- brain:verification\ncommit: ${realSha}\nimplemented_by: builder-agent\n-->`
  );
  ok("implemented_by without verified_by WARNs, not passes", indOf(unnamedVerifier)?.status === "warn", indOf(unnamedVerifier)?.detail);
  ok("...and says the receipt names no verifier", /names no verifier: alpha/.test(indOf(unnamedVerifier)?.detail || ""), indOf(unnamedVerifier)?.detail);

  const selfSilent = receiptBrain(
    "self-silent",
    `<!-- brain:verification\ncommit: ${realSha}\nverified_by: Sean\nimplemented_by: sean\n-->`
  );
  ok("equal identities (case-insensitive) WARN", indOf(selfSilent)?.status === "warn", indOf(selfSilent)?.detail);
  ok("...flagged as unacknowledged", /unacknowledged: alpha/.test(indOf(selfSilent)?.detail || ""), indOf(selfSilent)?.detail);
  // (these fixtures have no features/index.md, so that row fails independently —
  // the claim here is only that the independence row adds no failure)
  ok("...and a warn is not a failure",
    failsOf(selfSilent).length === failsOf(indep).length, failsOf(selfSilent).map((f) => f.check).join(", "));

  const selfAck = receiptBrain(
    "self-ack",
    `- **Independence**: self-verified — solo maintainer, no second agent\n\n<!-- brain:verification\ncommit: ${realSha}\nverified_by: sean\nimplemented_by: sean\n-->`
  );
  ok("declared self-verification is acknowledged (still warn)", indOf(selfAck)?.status === "warn", indOf(selfAck)?.detail);
  ok("...and carries the reason", /acknowledged: alpha \(sean: self-verified — solo maintainer/.test(indOf(selfAck)?.detail || ""), indOf(selfAck)?.detail);

  // A declaration outranks the receipt names: distinct defaults (bot-authored
  // HEAD vs git user.name) must not turn a declared self-verify into a pass.
  const selfAckDistinct = receiptBrain(
    "self-ack-distinct",
    `- **Independence**: self-verified — HEAD authored by a bot\n\n<!-- brain:verification\ncommit: ${realSha}\nverified_by: sean\nimplemented_by: dependabot\n-->`
  );
  ok("declared self-verification with distinct receipt names still WARNs",
    indOf(selfAckDistinct)?.status === "warn" && /acknowledged: alpha/.test(indOf(selfAckDistinct)?.detail || ""),
    indOf(selfAckDistinct)?.detail);

  // A fenced example of the declaration is documentation, not a declaration.
  const fencedAck = receiptBrain(
    "self-fenced",
    "```\n- **Independence**: self-verified — example\n```\n\n" +
      `<!-- brain:verification\ncommit: ${realSha}\nverified_by: sean\nimplemented_by: sean\n-->`
  );
  ok("a fenced Independence example does not count as acknowledgement",
    /unacknowledged: alpha/.test(indOf(fencedAck)?.detail || ""), indOf(fencedAck)?.detail);
  ok("parseIndependence reads the declaration",
    parseIndependence("- **Independence**: self-verified — why").self === true);
  ok("parseIndependence: absent is not declared", parseIndependence("# nothing").declared === false);

  // The NEWEST verification decides: an older independent PASS must not hide
  // a newer FAIL, and a same-day `-rN` round supersedes the base doc.
  const indepReceipt = `<!-- brain:verification\ncommit: ${realSha}\nverified_by: verifier-agent\nimplemented_by: builder-agent\n-->`;
  const verDocs = (name, docs) => {
    const brain = receiptBrain(name, "");
    const dir = path.join(brain, "features", "alpha", "verifications");
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
    for (const [file, body] of Object.entries(docs)) fs.writeFileSync(path.join(dir, file), body);
    return brain;
  };
  const newerFail = verDocs("newer-fail", {
    "2026-01-01.md": `# V\n\n**Verdict**: ✅ PASS\n\n${indepReceipt}\n`,
    "2026-01-02.md": "# V\n\n**Verdict**: ❌ FAIL\n",
  });
  ok("older independent PASS + newer FAIL WARNs independence", indOf(newerFail)?.status === "warn", indOf(newerFail)?.detail);
  ok("...naming the non-PASS latest doc",
    /latest verification not PASS: alpha \(2026-01-02: FAIL\)/.test(indOf(newerFail)?.detail || ""), indOf(newerFail)?.detail);
  ok("...and the row adds no failure", failsOf(newerFail).length === failsOf(indep).length,
    failsOf(newerFail).map((f) => f.check).join(", "));
  const roundPass = verDocs("round-pass", {
    "2026-01-01.md": "# V\n\n**Verdict**: ❌ FAIL\n",
    "2026-01-01-r2.md": `# V\n\n**Verdict**: ✅ PASS\n\n${indepReceipt}\n`,
  });
  ok("FAIL then independent PASS round (-r2) passes independence", indOf(roundPass)?.status === "pass", indOf(roundPass)?.detail);
  ok("...and adds no failure", failsOf(roundPass).length === failsOf(indep).length,
    failsOf(roundPass).map((f) => f.check).join(", "));

  // ---- Independence decision table, row for row (lib/review/brain-data.js
  // independenceRow header; .brain/rules/state.md). Each row below is judged
  // on the NEWEST doc only. Every case also asserts the row never fails.
  const PASS_H = "# V\n\n**Verdict**: ✅ PASS\n\n";
  const FAIL_H = "# V\n\n**Verdict**: ❌ FAIL\n\n";
  const rcpt = (fields) =>
    `<!-- brain:verification\ncommit: ${realSha}\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n-->`;
  const R_INDEP = rcpt({ verified_by: "verifier-agent", implemented_by: "builder-agent" });
  const R_SELF = rcpt({ verified_by: "sean", implemented_by: "Sean" });
  const R_LEGACY = rcpt({ verified_by: "fixture" });
  const R_UNNAMED = rcpt({ implemented_by: "builder-agent" });
  const DECL_SELF = "- **Independence**: self-verified — solo maintainer\n\n";
  const DECL_INDEP = "- **Independence**: independent — verifier-agent\n\n";
  const noIndFail = (label, brain) =>
    ok(`${label} — the independence row is never a fail`, indOf(brain)?.status !== "fail", indOf(brain)?.detail);
  const expectRow = (label, brain, status, re) => {
    const row = indOf(brain);
    ok(`table: ${label} → ${status}`, row?.status === status, row && `${row.status}: ${row.detail}`);
    if (re) ok(`table: ${label} → detail ${re}`, re.test(row?.detail || ""), row?.detail);
    noIndFail(`table: ${label}`, brain);
  };

  // Row 1 — no verification doc at all: not judged (the PASS row reports it).
  const t1 = verDocs("tbl-1-nodocs", {});
  expectRow("1 no docs", t1, "skip", /no receipt to judge/);
  ok("table: 1 no docs → the PASS row fails instead",
    brainCheck(t1, { strict: true }).find((r) => r.check === "every shipped feature has a PASS verification")?.status === "fail");

  // Row 2 — newest not PASS (FAIL, or an unreadable verdict), whatever the older docs say.
  expectRow("2 newest FAIL over independent PASS", verDocs("tbl-2-fail", {
    "2026-01-01.md": PASS_H + R_INDEP, "2026-01-02.md": FAIL_H + R_INDEP,
  }), "warn", /latest verification not PASS: alpha \(2026-01-02: FAIL\)/);
  expectRow("2 newest unknown verdict", verDocs("tbl-2-unknown", {
    "2026-01-01.md": PASS_H + R_INDEP, "2026-01-02.md": "# V\n\nno verdict here\n",
  }), "warn", /latest verification not PASS: alpha \(2026-01-02: unknown\)/);
  expectRow("2 -r2 FAIL round supersedes base PASS", verDocs("tbl-2-round", {
    "2026-01-01.md": PASS_H + R_INDEP, "2026-01-01-r2.md": FAIL_H,
  }), "warn", /latest verification not PASS: alpha \(2026-01-01-r2: FAIL\)/);

  // Row 3 — declared self-verified on the newest PASS: acknowledged, with or without a receipt.
  expectRow("3 declared self, receipt names differ", verDocs("tbl-3-distinct", {
    "2026-01-01.md": PASS_H + DECL_SELF + R_INDEP,
  }), "warn", /self-verified, acknowledged: alpha \(verifier-agent: self-verified — solo maintainer\)/);
  expectRow("3 declared self, no receipt", verDocs("tbl-3-noreceipt", {
    "2026-01-01.md": PASS_H + DECL_SELF,
  }), "warn", /self-verified, acknowledged: alpha \(unknown: self-verified/);
  expectRow("3 declared self, legacy receipt", verDocs("tbl-3-legacy", {
    "2026-01-01.md": PASS_H + DECL_SELF + R_LEGACY,
  }), "warn", /acknowledged: alpha/);
  // The declaration on an OLDER doc does not carry over to the newest one.
  expectRow("3 declaration on an older doc only", verDocs("tbl-3-older", {
    "2026-01-01.md": PASS_H + DECL_SELF + R_SELF, "2026-01-02.md": PASS_H + R_INDEP,
  }), "pass", /1 verified independently/);

  // Row 4 — newest PASS unstamped behind an older STAMPED PASS: warn. This is
  // the round-5 bug: before 64c7702 the older stamped receipt stood in for the
  // newest round and the row passed (the newer self-verified round hid).
  const t4 = verDocs("tbl-4-unstamped", {
    "2026-01-01.md": PASS_H + R_INDEP, "2026-01-02.md": PASS_H,
  });
  expectRow("4 newest PASS unstamped behind stamped PASS", t4, "warn", /latest PASS has no receipt: alpha \(2026-01-02\)/);
  ok("table: 4 → the bound row still passes (an older receipt binds), so only this row reports it",
    brainCheck(t4, { strict: true }).find((r) => r.check === RECEIPT_ROW)?.status === "pass");
  ok("table: 4 → not reported as independent", !/verified independently/.test(indOf(t4)?.detail || ""), indOf(t4)?.detail);
  expectRow("4 via -rN: unstamped r2 behind stamped base", verDocs("tbl-4-round", {
    "2026-01-01.md": PASS_H + R_INDEP, "2026-01-01-r2.md": PASS_H,
  }), "warn", /latest PASS has no receipt: alpha \(2026-01-01-r2\)/);
  // An Independence "independent" line is prose: it does not stand in for the receipt.
  expectRow("4 declared independent but unstamped", verDocs("tbl-4-declindep", {
    "2026-01-01.md": PASS_H + R_INDEP, "2026-01-02.md": PASS_H + DECL_INDEP,
  }), "warn", /latest PASS has no receipt/);

  // Row 5 — newest PASS unstamped and NO stamped PASS anywhere: not judged here;
  // the "bound to a commit" row fails, so the state is still reported once.
  const t5 = verDocs("tbl-5-nowhere", {
    "2026-01-01.md": FAIL_H + R_INDEP, "2026-01-02.md": PASS_H,
  });
  expectRow("5 no stamped PASS anywhere", t5, "skip", /no receipt to judge/);
  ok("table: 5 → the bound row fails instead",
    brainCheck(t5, { strict: true }).find((r) => r.check === RECEIPT_ROW)?.status === "fail");

  // Row 6 — legacy receipt (no implemented_by): not judged, named, skip when alone.
  expectRow("6 legacy receipt", verDocs("tbl-6-legacy", { "2026-01-01.md": PASS_H + R_LEGACY }),
    "skip", /1 receipt\(s\) predate implemented_by: alpha/);
  // A legacy newest round does NOT inherit an older independent receipt's pass.
  expectRow("6 legacy newest over independent older", verDocs("tbl-6-over", {
    "2026-01-01.md": PASS_H + R_INDEP, "2026-01-02.md": PASS_H + R_LEGACY,
  }), "skip", /predate implemented_by: alpha/);

  // Row 7 — implemented_by with a blank verified_by.
  expectRow("7 unnamed verifier", verDocs("tbl-7-unnamed", { "2026-01-01.md": PASS_H + R_UNNAMED }),
    "warn", /receipt names no verifier: alpha/);
  expectRow("7 whitespace verified_by", verDocs("tbl-7-blank", {
    "2026-01-01.md": PASS_H + rcpt({ verified_by: "   ", implemented_by: "builder-agent" }),
  }), "warn", /names no verifier: alpha/);

  // Row 8 — distinct names, but verified_by was a DEFAULT (git identity): a
  // bot-authored HEAD makes the defaults differ with no second agent → warn.
  const srcRcpt = (vs, is) => rcpt({ verified_by: "sean", implemented_by: "dependabot", verified_by_source: vs, implemented_by_source: is });
  expectRow("8 distinct names, both defaulted", verDocs("tbl-8-defaults", { "2026-01-01.md": PASS_H + srcRcpt("default", "default") }),
    "warn", /identities not declared: alpha \(2026-01-01\) — .*--verified-by <verifier>/);
  ok("table: 8 → not reported as independent",
    !/verified independently/.test(indOf(verDocs("tbl-8-defaults2", { "2026-01-01.md": PASS_H + srcRcpt("default", "default") }))?.detail || ""));
  expectRow("8 distinct names, verifier defaulted, implementer explicit", verDocs("tbl-8-mixed-v", {
    "2026-01-01.md": PASS_H + srcRcpt("default", "flag"),
  }), "warn", /identities not declared: alpha/);
  expectRow("8 unrecognised verified_by_source is not a declaration", verDocs("tbl-8-garbage", {
    "2026-01-01.md": PASS_H + srcRcpt("yes", "flag"),
  }), "warn", /identities not declared: alpha/);
  // Row 9 via explicit sources: both flags → pass; explicit verifier + default implementer → pass.
  expectRow("9 distinct names, both explicit", verDocs("tbl-9-flags", { "2026-01-01.md": PASS_H + srcRcpt("flag", "flag") }),
    "pass", /1 verified independently/);
  expectRow("9 distinct names, verifier explicit, implementer defaulted", verDocs("tbl-9-mixed-i", {
    "2026-01-01.md": PASS_H + srcRcpt("flag", "default"),
  }), "pass", /1 verified independently/);
  // Row 10 still wins over row 8 for equal names: defaults that agree are self-verified.
  expectRow("10 equal names, both defaulted", verDocs("tbl-10-defaults", {
    "2026-01-01.md": PASS_H + rcpt({ verified_by: "sean", implemented_by: "Sean", verified_by_source: "default", implemented_by_source: "default" }),
  }), "warn", /self-verified, unacknowledged: alpha \(sean\)/);

  // Row 9 — distinct names on the newest PASS; an older self round does not taint it.
  // R_INDEP has no source fields (legacy, pre-2026-09-30): judged as before — pass.
  expectRow("9 distinct identities (legacy, no source fields)", verDocs("tbl-8-indep", { "2026-01-01.md": PASS_H + R_INDEP }),
    "pass", /1 verified independently/);
  expectRow("9 independent r2 over self-verified base", verDocs("tbl-8-round", {
    "2026-01-01.md": PASS_H + R_SELF, "2026-01-01-r2.md": PASS_H + R_INDEP,
  }), "pass", /1 verified independently/);

  // Row 10 — equal names, no self declaration (an "independent" line does not help).
  expectRow("10 equal identities, silent", verDocs("tbl-9-silent", { "2026-01-01.md": PASS_H + R_SELF }),
    "warn", /self-verified, unacknowledged: alpha \(sean\)/);
  expectRow("10 equal identities, declared independent", verDocs("tbl-9-declindep", {
    "2026-01-01.md": PASS_H + DECL_INDEP + R_SELF,
  }), "warn", /unacknowledged: alpha/);
  expectRow("10 self r2 over independent base", verDocs("tbl-9-round", {
    "2026-01-01.md": PASS_H + R_INDEP, "2026-01-01-r2.md": PASS_H + R_SELF,
  }), "warn", /unacknowledged: alpha/);

  // -rN ordering is numeric: r10 is newer than r2 (string order would invert it).
  const t10 = verDocs("tbl-r10", {
    "2026-01-01.md": FAIL_H, "2026-01-01-r2.md": PASS_H + R_SELF, "2026-01-01-r10.md": PASS_H + R_INDEP,
  });
  ok("table: -rN ordering is numeric (r10 > r2 > base)",
    listVerifications(t10, "alpha").map((d) => d.date).join(",") === "2026-01-01-r10,2026-01-01-r2,2026-01-01",
    listVerifications(t10, "alpha").map((d) => d.date).join(","));
  expectRow("-r10 independent is the newest round", t10, "pass", /1 verified independently/);
  ok("table: a later day outranks any same-day round",
    listVerifications(verDocs("tbl-day", { "2026-01-01-r3.md": PASS_H, "2026-01-02.md": PASS_H }), "alpha")[0]?.date === "2026-01-02");

  // Aggregation across features: any warn bucket → warn; else any independent → pass; else skip.
  const multi = (name, perFeature) => {
    const brain = path.join(repo, name, ".brain");
    fs.mkdirSync(path.join(brain, "runs"), { recursive: true });
    fs.writeFileSync(path.join(brain, "runs", "progress.md"), "# Progress\n\n---\n");
    const slugs = Object.keys(perFeature);
    fs.mkdirSync(path.join(brain, "features"), { recursive: true });
    fs.writeFileSync(path.join(brain, "features", "feature_list.json"), JSON.stringify({
      features: slugs.map((s) => featureFor(s, { status: "shipped", evidence: "proof" })),
    }, null, 2) + "\n");
    for (const s of slugs) {
      const dir = path.join(brain, "features", s, "verifications");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(brain, "features", s, `${s}.md`), `# ${s}\n`);
      for (const [file, body] of Object.entries(perFeature[s])) fs.writeFileSync(path.join(dir, file), body);
    }
    return brain;
  };
  const one = (body) => ({ "2026-01-01.md": body });
  expectRow("mix: independent + legacy", multi("tbl-mix-pass", {
    alpha: one(PASS_H + R_INDEP), beta: one(PASS_H + R_LEGACY),
  }), "pass", /1 verified independently; 1 receipt\(s\) predate implemented_by: beta/);
  expectRow("mix: legacy + legacy", multi("tbl-mix-skip", {
    alpha: one(PASS_H + R_LEGACY), beta: one(PASS_H + R_LEGACY),
  }), "skip", /2 receipt\(s\) predate implemented_by: alpha, beta/);
  const mixAll = multi("tbl-mix-all", {
    a1: one(PASS_H + R_INDEP),
    a2: { "2026-01-01.md": PASS_H + R_INDEP, "2026-01-02.md": FAIL_H },
    a3: { "2026-01-01.md": PASS_H + R_INDEP, "2026-01-02.md": PASS_H },
    a4: one(PASS_H + R_SELF),
    a5: one(PASS_H + R_UNNAMED),
    a6: one(PASS_H + DECL_SELF + R_SELF),
    a7: one(PASS_H + R_LEGACY),
    a8: one(PASS_H + rcpt({ verified_by: "sean", implemented_by: "dependabot", verified_by_source: "default", implemented_by_source: "default" })),
  });
  expectRow("mix: one of every bucket", mixAll, "warn");
  for (const [bucket, re] of [
    ["stale", /latest verification not PASS: a2 \(2026-01-02: FAIL\)/],
    ["unstamped", /latest PASS has no receipt: a3 \(2026-01-02\)/],
    ["silent", /unacknowledged: a4 \(sean\)/],
    ["unnamed", /names no verifier: a5/],
    ["acknowledged", /acknowledged: a6 \(sean: self-verified/],
    ["independent", /1 verified independently/],
    ["legacy", /1 receipt\(s\) predate implemented_by: a7/],
    ["undeclared", /identities not declared: a8 \(2026-01-01\)/],
  ])
    ok(`table: mix names the ${bucket} bucket`, re.test(indOf(mixAll)?.detail || ""), indOf(mixAll)?.detail);
  // Non-strict brainCheck emits no warn row and no independence row: those are
  // strict-only, which is why the browser health strips now go through
  // healthChecks() (strict, strict-only rows tagged advisory) — Greptile round 6/7.
  const nonStrict = brainCheck(mixAll);
  ok("non-strict brainCheck emits no warn row (warns are strict-only)",
    !nonStrict.some((row) => row.status === "warn"), nonStrict.filter((row) => row.status === "warn").map((row) => row.check).join(", "));
  ok("non-strict brainCheck omits the independence row", !nonStrict.some((row) => row.check === IND_ROW));

  // ---- healthChecks(): the payload behind both health strips (/session/<key>/health
  // and /watch/context). Contract: strict rows reach the strip, but a strict-only
  // row is ALWAYS advisory, so enabling strict never turns a green strip red; a
  // non-strict row passes through untouched (a real fail stays red).
  const HEALTH_KEYS = new Set(["check", "status", "detail", "advisory"]);
  const healthContract = (label, brain) => {
    const base = brainCheck(brain);
    const health = healthChecks(brain);
    const baseNames = new Set(base.map((r) => r.check));
    ok(`health ${label}: every row is {check,status,detail[,advisory]}`,
      health.every((r) => Object.keys(r).every((k) => HEALTH_KEYS.has(k)) && typeof r.check === "string"),
      JSON.stringify(health.find((r) => !Object.keys(r).every((k) => HEALTH_KEYS.has(k)))));
    ok(`health ${label}: every non-strict row passes through, same status, not advisory`,
      base.every((b) => health.some((h) => h.check === b.check && h.status === b.status && !h.advisory)));
    ok(`health ${label}: every strict-only row is advisory`,
      health.filter((h) => !baseNames.has(h.check)).every((h) => h.advisory === true));
    const redHealth = health.filter((h) => h.status === "fail" && !h.advisory).map((h) => h.check).sort();
    const redBase = base.filter((b) => b.status === "fail").map((b) => b.check).sort();
    ok(`health ${label}: red rows == non-strict fails (strict never adds red)`,
      JSON.stringify(redHealth) === JSON.stringify(redBase), `${redHealth} vs ${redBase}`);
    return health;
  };
  const mixHealth = healthContract("mix", mixAll);
  const mixInd = mixHealth.find((r) => r.check === IND_ROW);
  ok("health: the independence warn reaches the strip as an advisory",
    mixInd?.status === "warn" && mixInd?.advisory === true, mixInd && JSON.stringify(mixInd));
  const t1Health = healthContract("no-docs", t1);
  const t1Pass = t1Health.find((r) => r.check === "every shipped feature has a PASS verification");
  ok("health: a strict-only FAIL is advisory, not red",
    t1Pass?.status === "fail" && t1Pass?.advisory === true, t1Pass && JSON.stringify(t1Pass));
  const cleanHealth = healthContract("independent", indep);
  ok("health: an all-independent brain has no advisory warn/fail",
    !cleanHealth.some((r) => r.advisory && (r.status === "warn" || r.status === "fail")),
    cleanHealth.filter((r) => r.advisory && r.status !== "pass" && r.status !== "skip").map((r) => r.check).join(", "));
  expectRow("mix: a single warn among independents", multi("tbl-mix-onewarn", {
    alpha: one(PASS_H + R_INDEP), beta: one(PASS_H + R_INDEP), gamma: one(PASS_H + R_SELF),
  }), "warn", /unacknowledged: gamma.*2 verified independently/);
}

// ---------------------------------------------------------------------------
// 4b. tasks.json check rows — "tasks.json files parse" and "no shipped
// feature has an open task" (feat-009 task-coordination, phase 2 — the gate).
// Read-compat is non-negotiable: a feature (or a whole brain) that never
// adopted tasks.json must keep passing every row, vacuously, not by skipping
// the row or reporting something unverifiable.
// ---------------------------------------------------------------------------

{
  // No tasks.json anywhere — both rows PASS vacuously (not skip, not error —
  // this is the literal read-compat contract in the feature's design table).
  const brain = makeBrain("tasks-check-absent", { features: [featureFor("alpha")] });
  const parseRow = brainCheck(brain).find((r) => r.check === "tasks.json files parse");
  const gateRow = brainCheck(brain).find((r) => r.check === "no shipped feature has an open task");
  ok(
    "tasks.json files parse PASSES with no tasks.json anywhere",
    parseRow?.status === "pass",
    parseRow && `${parseRow.status}: ${parseRow.detail}`
  );
  ok(
    "no shipped feature has an open task PASSES with no tasks.json anywhere",
    gateRow?.status === "pass",
    gateRow && `${gateRow.status}: ${gateRow.detail}`
  );
  ok(
    "...and reports 0 files checked rather than silently skipping",
    /^0 tasks\.json file\(s\) checked$/.test(parseRow?.detail || ""),
    parseRow?.detail
  );
}

{
  // Malformed JSON in one feature's tasks.json fails the parse row and names it.
  const brain = makeBrain("tasks-check-badjson", { features: [featureFor("alpha")] });
  fs.writeFileSync(tasksPath(brain, "alpha"), "{ not json");
  const row = brainCheck(brain).find((r) => r.check === "tasks.json files parse");
  ok("malformed tasks.json FAILS the parse row", row?.status === "fail", row && `${row.status}: ${row.detail}`);
  ok("...and names the file", /alpha\/tasks\.json/.test(row?.detail || ""), row?.detail);
  // A NON-strict fail must stay red on the health strips (not demoted to advisory).
  const hrow = healthChecks(brain).find((r) => r.check === "tasks.json files parse");
  ok("health: a non-strict FAIL stays red (not advisory)", hrow?.status === "fail" && !hrow?.advisory, hrow && JSON.stringify(hrow));
}

{
  // Schema-invalid tasks.json fails with validateTasksShape's OWN message —
  // one definition, reused, not a second one drifting from it.
  const brain = makeBrain("tasks-check-badshape", { features: [featureFor("alpha")] });
  fs.writeFileSync(
    tasksPath(brain, "alpha"),
    JSON.stringify({ tasks: [{ id: "t1", title: "x", status: "not-a-status", acceptance: "y" }] }, null, 2)
  );
  const row = brainCheck(brain).find((r) => r.check === "tasks.json files parse");
  ok("schema-invalid tasks.json FAILS the parse row", row?.status === "fail", row && `${row.status}: ${row.detail}`);
  ok("...naming the exact bad field", /tasks\[0\]\.status/.test(row?.detail || ""), row?.detail);
}

{
  // The headline invariant: a SHIPPED feature with an open task fails, naming
  // both the feature and the open task id — done/cut tasks do not count as open.
  const brain = makeBrain("tasks-check-shipped-open", {
    features: [featureFor("alpha", { status: "shipped", evidence: "proof" })],
  });
  fs.writeFileSync(
    tasksPath(brain, "alpha"),
    JSON.stringify(
      {
        feature: "alpha",
        tasks: [
          { id: "t1", title: "done one", status: "done", acceptance: "x", evidence: "y" },
          { id: "t2", title: "open one", status: "open", acceptance: "x" },
          { id: "t3", title: "cut one", status: "cut", acceptance: "x" },
        ],
      },
      null,
      2
    )
  );
  const row = brainCheck(brain).find((r) => r.check === "no shipped feature has an open task");
  ok("shipped feature with an open task FAILS", row?.status === "fail", row && `${row.status}: ${row.detail}`);
  ok("...naming the feature", /alpha/.test(row?.detail || ""), row?.detail);
  ok("...naming the open task id", /\bt2\b/.test(row?.detail || ""), row?.detail);
  ok(
    "...and NOT the done/cut tasks (they are not open)",
    !/\bt1\b/.test(row?.detail || "") && !/\bt3\b/.test(row?.detail || ""),
    row?.detail
  );
}

{
  // A shipped feature whose tasks are ALL done/cut passes — the row is not
  // simply always-red once a feature has a tasks.json at all.
  const brain = makeBrain("tasks-check-shipped-closed", {
    features: [featureFor("alpha", { status: "shipped", evidence: "proof" })],
  });
  fs.writeFileSync(
    tasksPath(brain, "alpha"),
    JSON.stringify(
      { feature: "alpha", tasks: [{ id: "t1", title: "x", status: "done", acceptance: "y", evidence: "z" }] },
      null,
      2
    )
  );
  const row = brainCheck(brain).find((r) => r.check === "no shipped feature has an open task");
  ok("shipped feature with only closed tasks PASSES", row?.status === "pass", row && `${row.status}: ${row.detail}`);
}

{
  // `scope` narrows this exactly like every other per-feature row above: an
  // UNRELATED feature's open task (or malformed tasks.json) must never refuse
  // a ship scoped to a DIFFERENT feature — the same deadlock `scope` already
  // fixed once for the other nine rows.
  const brain = makeBrain("tasks-check-scope", {
    features: [
      featureFor("legacy", { status: "shipped", evidence: "proof" }),
      featureFor("fresh", { status: "shipped", evidence: "proof" }),
    ],
  });
  fs.writeFileSync(
    tasksPath(brain, "legacy"),
    JSON.stringify({ feature: "legacy", tasks: [{ id: "t1", title: "x", status: "open", acceptance: "y" }] }, null, 2)
  );
  fs.writeFileSync(
    tasksPath(brain, "fresh"),
    JSON.stringify(
      { feature: "fresh", tasks: [{ id: "t1", title: "x", status: "done", acceptance: "y", evidence: "z" }] },
      null,
      2
    )
  );
  const wholeFail = brainCheck(brain).find((r) => r.check === "no shipped feature has an open task");
  ok(
    "unscoped audit reports the legacy gap",
    wholeFail?.status === "fail",
    wholeFail && `${wholeFail.status}: ${wholeFail.detail}`
  );
  const scoped = brainCheck(brain, { scope: "fresh" }).find(
    (r) => r.check === "no shipped feature has an open task"
  );
  ok(
    "scoped to the OTHER feature ignores the legacy gap",
    scoped?.status === "pass",
    scoped && `${scoped.status}: ${scoped.detail}`
  );
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


{
  // Drift false-negatives found by adversarial review AFTER the check shipped.
  const brain = makeBrain("index-fn", {
    features: [
      featureFor("alpha", { status: "shipped", evidence: "proof" }),
      featureFor("beta", { status: "planned" }),
    ],
  });
  const idx = path.join(brain, "features", "index.md");
  const driftRow = () =>
    brainCheck(brain).find((r) => r.check === "features/index.md agrees with the tracker");

  // A GUTTED index used to report "no rows to compare" and pass — deleting the
  // table was the cheapest way to silence the check.
  fs.writeFileSync(idx, "# Features\n\nNo table here.\n");
  ok("gutted index.md FAILS", driftRow()?.status === "fail", driftRow()?.detail);

  // "in progress" (space, not hyphen) is not a status; the row used to skip.
  fs.writeFileSync(
    idx,
    "| F | File | Status |\n|---|---|---|\n" +
      "| Alpha | [`alpha/alpha.md`](alpha/alpha.md) | in progress |\n" +
      "| Beta | [`beta/beta.md`](beta/beta.md) | planned |\n"
  );
  const noStatus = driftRow();
  ok("row with an unrecognizable status FAILS", noStatus?.status === "fail", noStatus?.detail);
  ok(
    "...and says the status was not recognized",
    /no recognizable status/.test(noStatus?.detail || ""),
    noStatus?.detail
  );
}

{
  // B1 — the scope of the strict ship gate.
  //
  // `brain ship` is always strict. Preflighting the WHOLE brain meant one legacy
  // feature that predates the invariant refused EVERY future ship in the repo,
  // which made the flagship gate unusable in the two repos that own it. Shipping
  // X asserts that X works; it does not assert that a feature shipped a year ago
  // has a receipt.
  const brain = makeBrain(
    "strict-scope",
    {
      features: [
        // Legacy: shipped long ago, no verification doc. Must NOT block others.
        featureFor("legacy", { status: "shipped", evidence: "shipped before the invariant" }),
        featureFor("fresh", { status: "in-progress" }),
      ],
    },
    { verdictDoc: PASS_DOC }
  );
  // makeBrain wrote a PASS doc for BOTH features; remove legacy's so it is unproven.
  fs.rmSync(path.join(brain, "features", "legacy", "verifications"), { recursive: true, force: true });

  const whole = brainCheck(brain, { strict: true }).filter((r) => r.status === "fail");
  // Assert the RIGHT row failed, not merely that something did. `whole.length > 0`
  // was satisfied by any unrelated regression anywhere in brainCheck, so it would
  // have gone on passing after the check it names stopped working.
  ok(
    "unscoped strict still reports the legacy gap (it is the audit)",
    whole.some(
      (r) => r.check === "every shipped feature has a PASS verification" && /legacy/.test(r.detail)
    ),
    `expected the PASS-verification row to name "legacy"; got ${whole.map((r) => r.check).join(", ") || "no failures"}`
  );

  // `scope` is the current name; `strictScope` is kept as a read-compat alias
  // and must still narrow the gate identically.
  const scoped = brainCheck(brain, { strict: true, strictScope: "fresh" }).filter((r) => r.status === "fail");
  const scopedNewName = brainCheck(brain, { strict: true, scope: "fresh" }).filter((r) => r.status === "fail");
  ok(
    "the strictScope alias behaves exactly like scope",
    scopedNewName.length === scoped.length,
    `scope=${scopedNewName.length} vs strictScope=${scoped.length}`
  );
  ok(
    "strict scoped to the shipping feature ignores unrelated legacy gaps",
    scoped.length === 0,
    scoped.map((r) => `${r.check}: ${r.detail}`).join(" | ")
  );

  // And the CLI actually ships it, rather than being blocked by `legacy`.
  const res = spawnSync(
    process.execPath,
    [CLI, "ship", "fresh", "--evidence", "scoped strict proof", "--brain", brain],
    { encoding: "utf8" }
  );
  ok("ship succeeds despite an unrelated unproven legacy feature", res.status === 0,
    `exit ${res.status}: ${(res.stdout || "").split("\n").slice(0, 4).join(" / ")}`);

  // But it still refuses when THIS feature lacks proof.
  const brain2 = makeBrain("strict-scope-2", {
    features: [featureFor("unproven", { status: "in-progress" })],
  });
  const res2 = spawnSync(
    process.execPath,
    [CLI, "ship", "unproven", "--evidence", "no doc at all", "--brain", brain2],
    { encoding: "utf8" }
  );
  ok("ship still refuses when the shipping feature itself has no proof", res2.status === 1,
    `exit ${res2.status}`);
}


{
  // END-TO-END SHIP INTO AN INDEXED BRAIN.
  //
  // This is the test whose absence let a deadlock ship: the index-drift check ran
  // against the PROJECTED state, but features/index.md is generated FROM the
  // tracker, so on disk it still (correctly) said in-progress. Every ship in
  // every indexed brain was refused, and the only escape was hand-editing the
  // index to a premature `shipped`. A gate satisfiable only by lying is worse
  // than no gate. Nothing caught it because no fixture ever shipped a feature
  // through a brain that had an index.
  const brain = makeBrain(
    "e2e-indexed-ship",
    { features: [featureFor("alpha", { status: "in-progress" })] },
    { verdictDoc: PASS_DOC }
  );
  const idxRes = spawnSync(
    process.execPath,
    [CLI, "features", "index", "--write", "--create", "--brain", brain],
    { encoding: "utf8" }
  );
  ok("features index --write --create scaffolds the index", idxRes.status === 0,
    `exit ${idxRes.status}: ${(idxRes.stdout || "").slice(0, 160)}`);
  const idxPath = path.join(brain, "features", "index.md");
  ok("index.md exists after --create", fs.existsSync(idxPath));
  ok("generated index shows in-progress before the ship",
    /alpha[\s\S]*in-progress/.test(fs.readFileSync(idxPath, "utf8")));

  const ship = spawnSync(
    process.execPath,
    [CLI, "ship", "alpha", "--evidence", "e2e indexed ship", "--brain", brain],
    { encoding: "utf8" }
  );
  ok("ship SUCCEEDS in an indexed brain", ship.status === 0,
    `exit ${ship.status}: ${(ship.stdout || "").split("\n").slice(0, 5).join(" / ")}`);
  ok("ship regenerated the index", /index: features\/index\.md regenerated/.test(ship.stdout || ""),
    (ship.stdout || "").slice(0, 200));
  ok("index now shows shipped", /alpha[\s\S]*shipped/.test(fs.readFileSync(idxPath, "utf8")));

  const after = spawnSync(process.execPath, [CLI, "check", "--brain", brain], { encoding: "utf8" });
  ok("brain check passes after the ship (no drift left behind)", after.status === 0,
    (after.stdout || "").slice(0, 300));
}

{
  // B.2 — a MISSING index is not agreement. Deleting the file was the cheapest
  // permanent way to silence the drift check.
  const brain = makeBrain(
    "index-missing",
    { features: [featureFor("alpha", { status: "planned" })] },
    { noIndex: true }
  );
  const row = brainCheck(brain).find((r) => r.check === "features/index.md agrees with the tracker");
  ok("missing index.md with tracked features FAILS", row?.status === "fail", row?.detail);
  ok("...and points at --create", /--create/.test(row?.detail || ""), row?.detail);
}

{
  // B.1 — the receipt lookahead defeated itself: it scanned the rest of the
  // document, so ANY doc containing a receipt kept every earlier comment
  // unstripped. The invisible-verdict attack then worked precisely on the docs
  // that satisfy the strict gate.
  ok(
    "a verdict hidden in a comment does not score even when a receipt follows",
    parseVerdict("<!--\n**Verdict**: ✅ PASS\n-->\n\n<!-- brain:verification\ncommit: abc\n-->") ===
      "unknown"
  );
  ok(
    "a verdict inside the receipt body itself does not score",
    parseVerdict("<!-- brain:verification\ncommit: abc\n**Verdict**: ✅ PASS\n-->") === "unknown"
  );
  ok(
    "a real verdict alongside a receipt still parses",
    parseVerdict("**Verdict**: ✅ PASS\n\n<!-- brain:verification\ncommit: abc\n-->") === "PASS"
  );
}


{
  // N1 — an UNCLOSED html comment hides everything after it in every renderer.
  // The closed case was fixed; the unclosed one was not considered, which is the
  // same oversight the fence rules already made once.
  ok("unclosed comment hides a verdict", parseVerdict("<!--\n**Verdict**: ✅ PASS") === "unknown");
  ok(
    "unclosed comment + a valid receipt still scores nothing",
    parseVerdict("<!--\n**Verdict**: ✅ PASS\n\n<!-- brain:verification\ncommit: abc1234\n-->") === "unknown"
  );

  // N6 — symbolic refs resolve through git but move, so they bind to nothing.
  for (const ref of ["HEAD", "main", "v1.0.0", "HEAD~2", "origin/main"]) {
    const r = parseReceipt(`<!-- brain:verification\ncommit: ${ref}\n-->`);
    ok(`receipt commit "${ref}" is rejected as symbolic`, r.commit === null && r.commit_symbolic === true,
      JSON.stringify(r));
  }
  const hex = parseReceipt("<!-- brain:verification\ncommit: 1a2b3c4\n-->");
  ok("a hex sha is accepted", hex.commit === "1a2b3c4" && hex.commit_symbolic === false, JSON.stringify(hex));
}

{
  // N4/N5 — the exemption key had no integrity check, so adding a slug turned the
  // gate off for it. New work could ship unverified by listing itself.
  const gfRow = (brain) =>
    brainCheck(brain, { strict: true }).find((r) => r.check === "strict grandfather list is legitimate");

  const unknown = makeBrain("gf-unknown", {
    policy: { strict_grandfathered: ["ghost"] },
    features: [featureFor("alpha", { status: "shipped", evidence: "e" })],
  });
  ok("grandfathering an unknown slug FAILS", gfRow(unknown)?.status === "fail", gfRow(unknown)?.detail);

  const notShipped = makeBrain("gf-notshipped", {
    policy: { strict_grandfathered: ["beta"] },
    features: [
      featureFor("alpha", { status: "shipped", evidence: "e" }),
      featureFor("beta", { status: "in-progress" }),
    ],
  });
  const r = gfRow(notShipped);
  ok("grandfathering a non-shipped slug FAILS", r?.status === "fail", r?.detail);
  ok("...and says why", /not shipped/.test(r?.detail || ""), r?.detail);

  const cut = makeBrain("gf-cut", {
    policy: { strict_grandfathered: ["gamma"] },
    features: [featureFor("gamma", { status: "cut", evidence: "" })],
  });
  ok("grandfathering a CUT slug FAILS (the real template bug)", gfRow(cut)?.status === "fail", gfRow(cut)?.detail);

  // A legitimate list passes, so the check is not simply always-red.
  const good = makeBrain("gf-good", {
    policy: { strict_grandfathered: ["alpha"] },
    features: [featureFor("alpha", { status: "shipped", evidence: "legacy" })],
  });
  ok("a legitimate grandfather list passes", gfRow(good)?.status === "pass", gfRow(good)?.detail);
}

{
  // N2 — set-status must regenerate the derived index too. Wiring regen into ship
  // alone let set-status take the brain green -> red while exiting 0.
  const brain = makeBrain(
    "setstatus-regen",
    { features: [featureFor("alpha", { status: "planned" })] },
    { verdictDoc: PASS_DOC }
  );
  const res = spawnSync(
    process.execPath,
    [CLI, "features", "set-status", "alpha", "--status", "blocked", "--brain", brain],
    { encoding: "utf8" }
  );
  ok("set-status exits 0", res.status === 0, `exit ${res.status}`);
  ok("set-status regenerated the index", /index: features\/index\.md regenerated/.test(res.stdout || ""),
    (res.stdout || "").slice(0, 200));
  const after = spawnSync(process.execPath, [CLI, "check", "--brain", brain], { encoding: "utf8" });
  ok("brain check is still green after set-status", after.status === 0,
    (after.stdout || "").slice(0, 300));
}

{
  // N3 — ship must not leave drift behind in the markerless / missing index
  // states. Both previously exited 0 and left `brain check` red.
  const markerless = makeBrain(
    "ship-markerless",
    { features: [featureFor("alpha", { status: "in-progress" })] },
    { verdictDoc: PASS_DOC }
  );
  fs.writeFileSync(
    path.join(markerless, "features", "index.md"),
    "| F | File | Status |\n|---|---|---|\n| Alpha | [`alpha/alpha.md`](alpha/alpha.md) | in-progress |\n"
  );
  const res = spawnSync(
    process.execPath,
    [CLI, "ship", "alpha", "--evidence", "markerless index", "--brain", markerless],
    { encoding: "utf8" }
  );
  const combined = (res.stdout || "") + (res.stderr || "");
  ok(
    "ship into a markerless index does NOT silently succeed",
    res.status === 1 && /post_ship_checks/.test(combined),
    `exit ${res.status}: ${combined.slice(0, 260)}`
  );
  ok("...and says the markers are missing", /brain:features-table markers/.test(combined), combined.slice(0, 200));
}

// ---------------------------------------------------------------------------
// 8. Rows that shipped with NO fixture at all
//
// rules/state.md: "a validator with no failing fixture is a claim, not a
// check." Nine brainCheck rows were shipped in violation of that line, in the
// branch that wrote it — including the raw-HTML ban, which is 20 lines of
// careful logic with a paragraph of justification and no test. Each case below
// is a mutation that previously survived the suite untouched.
// ---------------------------------------------------------------------------

// Assert one named row has one named status. Every earlier "some check failed"
// assertion could be satisfied by an unrelated regression.
function rowStatus(checks, name) {
  const row = checks.find((r) => r.check === name);
  return row ? row.status : `<no row "${name}">`;
}

{
  const brain = makeBrain("rows-clean", { features: [featureFor("alpha", { status: "in-progress" })] }, { verdictDoc: PASS_DOC });
  const clean = brainCheck(brain);
  for (const row of [
    "every feature doc path resolves",
    "runs/progress.md exists",
    "plan meta.json files parse",
    "reviews.jsonl lines parse",
    "verification docs contain no raw HTML",
    "verification doc image links resolve",
  ]) {
    ok(`baseline: "${row}" passes on a clean brain`, rowStatus(clean, row) === "pass", `${row} -> ${rowStatus(clean, row)}`);
  }

  // --- feature doc paths resolve -------------------------------------------
  fs.rmSync(path.join(brain, "features", "alpha", "alpha.md"));
  ok(
    "a missing feature doc fails its row",
    rowStatus(brainCheck(brain), "every feature doc path resolves") === "fail"
  );
  fs.writeFileSync(path.join(brain, "features", "alpha", "alpha.md"), "# Alpha\n");

  // --- runs/progress.md exists ---------------------------------------------
  const progress = path.join(brain, "runs", "progress.md");
  const progressBody = fs.readFileSync(progress);
  fs.rmSync(progress);
  ok(
    "a missing runs/progress.md fails its row",
    rowStatus(brainCheck(brain), "runs/progress.md exists") === "fail"
  );
  fs.writeFileSync(progress, progressBody);

  // --- plan meta.json files parse ------------------------------------------
  const planDir = path.join(brain, "features", "alpha", "plans", "some-plan");
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, "meta.json"), "{ not json");
  ok(
    "a malformed plan meta.json fails its row",
    rowStatus(brainCheck(brain), "plan meta.json files parse") === "fail"
  );
  fs.writeFileSync(path.join(planDir, "meta.json"), JSON.stringify({ slug: "some-plan" }) + "\n");
  ok(
    "...and passes once it parses",
    rowStatus(brainCheck(brain), "plan meta.json files parse") === "pass"
  );

  // --- reviews.jsonl lines parse -------------------------------------------
  fs.writeFileSync(path.join(planDir, "reviews.jsonl"), '{"round":1}\nNOT JSON\n');
  ok(
    "a malformed reviews.jsonl line fails its row",
    rowStatus(brainCheck(brain), "reviews.jsonl lines parse") === "fail"
  );
  fs.writeFileSync(path.join(planDir, "reviews.jsonl"), '{"round":1}\n\n');
  ok(
    "...and a blank trailing line is not a parse failure",
    rowStatus(brainCheck(brain), "reviews.jsonl lines parse") === "pass"
  );

  // --- verification docs contain no raw HTML -------------------------------
  // The ban exists because a verdict inside <details> renders collapsed and one
  // inside <div> renders as literal asterisks — the rendered doc and the parsed
  // doc disagree. The receipt is the ONE permitted HTML construct.
  const vdoc = path.join(brain, "features", "alpha", "verifications", "2026-07-31.md");
  for (const [label, html] of [
    ["<details>", "<details><summary>proof</summary>\n\n**Verdict**: ✅ PASS\n\n</details>"],
    ["<div>", "<div>\n\n**Verdict**: ✅ PASS\n\n</div>"],
    ["<br>", "**Verdict**: ✅ PASS<br>"],
  ]) {
    fs.writeFileSync(vdoc, `# V\n\n${html}\n\n<!-- brain:verification\ncommit: abc1234\n-->\n`);
    ok(
      `raw HTML ${label} in a verification doc fails the ban`,
      rowStatus(brainCheck(brain), "verification docs contain no raw HTML") === "fail",
      `${label} -> ${rowStatus(brainCheck(brain), "verification docs contain no raw HTML")}`
    );
  }
  // The receipt itself must NOT trip the ban it is exempt from.
  fs.writeFileSync(vdoc, PASS_DOC);
  ok(
    "the brain:verification receipt is exempt from the raw-HTML ban",
    rowStatus(brainCheck(brain), "verification docs contain no raw HTML") === "pass",
    rowStatus(brainCheck(brain), "verification docs contain no raw HTML")
  );

  // --- verification doc image links resolve --------------------------------
  fs.writeFileSync(vdoc, PASS_DOC + "\n![step](../screenshots/01-nope.png)\n");
  ok(
    "a verification doc citing a missing screenshot fails its row",
    rowStatus(brainCheck(brain), "verification doc image links resolve") === "fail"
  );
  const shotDir = path.join(brain, "features", "alpha", "screenshots");
  fs.mkdirSync(shotDir, { recursive: true });
  fs.writeFileSync(path.join(shotDir, "01-nope.png"), "not really a png");
  ok(
    "...and passes once the screenshot exists",
    rowStatus(brainCheck(brain), "verification doc image links resolve") === "pass"
  );
}

// ---------------------------------------------------------------------------
// 9. SCOPE — the gate/audit split, for every per-feature row
//
// strictScope narrowed only the two strict rows. The other seven still swept
// the whole brain at the ship gate, so one stray <div> in an UNRELATED legacy
// verification doc, one moved screenshot, or one malformed plan meta.json
// refused every future ship in the repo — pointing at a file the shipper never
// touched. Same deadlock strictScope already fixed once, left half-fixed.
// ---------------------------------------------------------------------------

{
  const brain = makeBrain(
    "scope-unrelated-debt",
    {
      features: [
        featureFor("rotten", { status: "shipped", evidence: "shipped before the invariant" }),
        featureFor("fresh", { status: "in-progress" }),
      ],
      policy: { strict_grandfathered: ["rotten"] },
    },
    { verdictDoc: PASS_DOC }
  );

  // Three independent kinds of rot, all belonging to `rotten`, none to `fresh`.
  const rottenVdoc = path.join(brain, "features", "rotten", "verifications", "2026-07-31.md");
  fs.writeFileSync(
    rottenVdoc,
    "# V\n\n<div>\n\n**Verdict**: ✅ PASS\n\n</div>\n\n![gone](../screenshots/99-missing.png)\n"
  );
  const rottenPlan = path.join(brain, "features", "rotten", "plans", "old-plan");
  fs.mkdirSync(rottenPlan, { recursive: true });
  fs.writeFileSync(path.join(rottenPlan, "meta.json"), "{ truncated");

  const audit = brainCheck(brain).filter((r) => r.status === "fail");
  ok(
    "unscoped, all three kinds of unrelated rot are reported (it is the audit)",
    ["verification docs contain no raw HTML", "verification doc image links resolve", "plan meta.json files parse"].every(
      (name) => audit.some((r) => r.check === name)
    ),
    audit.map((r) => r.check).join(", ") || "nothing failed"
  );

  const gate = brainCheck(brain, { list: JSON.parse(fs.readFileSync(path.join(brain, "features", "feature_list.json"), "utf8")), strict: true, scope: "fresh" }).filter(
    (r) => r.status === "fail"
  );
  ok(
    "scoped to `fresh`, none of `rotten`'s debt is reported",
    gate.length === 0,
    gate.map((r) => `${r.check}: ${r.detail}`).join(" | ")
  );

  // A MISSING FEATURE DOC on the unrelated feature, too. This row was the ONE
  // per-feature check the scope pass missed: every other one was narrowed while
  // this kept sweeping the whole tracker, so unrelated documentation debt still
  // refused a valid ship. Found by an independent reviewer rather than by the
  // fixtures above — none of them deleted a doc belonging to a DIFFERENT
  // feature, so the whole class was untested.
  fs.rmSync(path.join(brain, "features", "rotten", "rotten.md"));
  const docAudit = brainCheck(brain).filter((r) => r.status === "fail");
  ok(
    "unscoped, a missing doc on another feature is reported",
    docAudit.some((r) => r.check === "every feature doc path resolves"),
    docAudit.map((r) => r.check).join(", ") || "nothing failed"
  );
  const docGate = brainCheck(brain, { strict: true, scope: "fresh" }).filter((r) => r.status === "fail");
  ok(
    "scoped, a missing doc on another feature does NOT block",
    !docGate.some((r) => r.check === "every feature doc path resolves"),
    docGate.map((r) => `${r.check}: ${r.detail}`).join(" | ")
  );

  // And end-to-end through the CLI: the ship must actually go through.
  const res = spawnSync(
    process.execPath,
    [CLI, "ship", "fresh", "--evidence", "unrelated rot must not block this", "--brain", brain],
    { encoding: "utf8" }
  );
  ok(
    "ship succeeds despite raw HTML, a dead image link, and a bad plan on ANOTHER feature",
    res.status === 0,
    `exit ${res.status}: ${((res.stdout || "") + (res.stderr || "")).slice(0, 300)}`
  );

  // The audit is unchanged by the ship — scoping the gate must not silence the report.
  const after = brainCheck(brain).filter((r) => r.status === "fail");
  ok(
    "the whole-brain audit still reports the rot after the scoped ship",
    after.some((r) => r.check === "verification docs contain no raw HTML"),
    after.map((r) => r.check).join(", ") || "nothing failed"
  );
}

{
  // The other half: rot on the feature BEING shipped still refuses it. Scoping
  // must narrow the gate, not disable it.
  const brain = makeBrain(
    "scope-own-debt",
    { features: [featureFor("alpha", { status: "in-progress" })] },
    { verdictDoc: PASS_DOC }
  );
  fs.writeFileSync(
    path.join(brain, "features", "alpha", "verifications", "2026-07-31.md"),
    "# V\n\n<div>\n\n**Verdict**: ✅ PASS\n\n</div>\n\n<!-- brain:verification\ncommit: abc1234\n-->\n"
  );
  const res = spawnSync(
    process.execPath,
    [CLI, "ship", "alpha", "--evidence", "own rot must block"],
    { encoding: "utf8", env: { ...process.env }, cwd: path.dirname(brain) }
  );
  const combined = (res.stdout || "") + (res.stderr || "");
  ok(
    "ship IS refused when the raw HTML is on the feature being shipped",
    res.status === 1 && /raw HTML/.test(combined),
    `exit ${res.status}: ${combined.slice(0, 300)}`
  );
}

// ---------------------------------------------------------------------------
// 10. A gate over the empty set is not a pass
//
// Once every shipped feature sits on policy.strict_grandfathered, the strict
// rows evaluate NOTHING and used to report `pass` with "0 shipped feature(s)
// proven" — a green tick over the empty set, printed by the very commit that
// promoted strict "from advisory to a gate".
// ---------------------------------------------------------------------------

{
  const brain = makeBrain("strict-vacuous", {
    features: [featureFor("legacy", { status: "shipped", evidence: "predates the invariant" })],
    policy: { strict_grandfathered: ["legacy"] },
  });
  const rows = brainCheck(brain, { strict: true });
  ok(
    "a strict gate with nothing to evaluate reports skip, not pass",
    rowStatus(rows, "every shipped feature has a PASS verification") === "skip",
    rowStatus(rows, "every shipped feature has a PASS verification")
  );
  ok(
    "the receipt row skips too",
    rowStatus(rows, "every PASS verification is bound to a commit") === "skip"
  );
  ok(
    "the skip names the outstanding debt",
    /1 shipped feature\(s\), 1 on policy\.strict_grandfathered/.test(
      rows.find((r) => r.check === "every shipped feature has a PASS verification").detail
    ),
    rows.find((r) => r.check === "every shipped feature has a PASS verification").detail
  );
  ok(
    "skip is not a failure — exit stays 0",
    rows.filter((r) => r.status === "fail").length === 0,
    rows.filter((r) => r.status === "fail").map((r) => r.check).join(", ")
  );

  // With one feature OFF the list, the gate has something to evaluate again and
  // must go back to reporting a real verdict.
  const brain2 = makeBrain(
    "strict-nonvacuous",
    {
      features: [
        featureFor("legacy", { status: "shipped", evidence: "predates the invariant" }),
        featureFor("proven", { status: "shipped", evidence: "verified" }),
      ],
      policy: { strict_grandfathered: ["legacy"] },
    },
    { verdictDoc: PASS_DOC }
  );
  fs.rmSync(path.join(brain2, "features", "legacy", "verifications"), { recursive: true, force: true });
  const rows2 = brainCheck(brain2, { strict: true });
  ok(
    "with one feature off the list the gate evaluates again",
    rowStatus(rows2, "every shipped feature has a PASS verification") === "pass",
    rowStatus(rows2, "every shipped feature has a PASS verification")
  );
}

// ---------------------------------------------------------------------------
// 11. tasks.json — features/<slug>/tasks.json, the coordination layer below a
// feature. Same discipline as the feature-list section above: every malformed
// shape here is one that must produce exactly ONE message naming the right
// index and field, never a silent coercion.
// ---------------------------------------------------------------------------

function validTask(over = {}) {
  return {
    id: "t1",
    title: "The record",
    status: "open",
    acceptance: "what makes this task checkably done",
    depends_on: [],
    files: ["lib/state.js"],
    ...over,
  };
}

const validTasks = {
  updated: "2026-08-06",
  feature: "task-coordination",
  tasks: [validTask()],
};

acceptsTasks("valid task list", validTasks, "task-coordination");
acceptsTasks("valid task list, no slug given to check against", validTasks);
acceptsTasks("empty tasks array", { tasks: [] });
acceptsTasks("no feature key", { tasks: [validTask()] });

rejectsTasks("bare {} for tasks.json", {}, `"tasks" must be an array`);
rejectsTasks("bare [] for tasks.json", [], "must be a JSON object");
rejectsTasks("a string for tasks.json", "hello", "must be a JSON object");
rejectsTasks("tasks as a string", { tasks: "nope" }, `"tasks" must be an array`);
rejectsTasks("tasks as an object", { tasks: {} }, `"tasks" must be an array`);
rejectsTasks("a task entry is not an object", { tasks: ["x"] }, "tasks[0] must be an object");

rejectsTasks(
  "feature key does not match the slug asked about",
  { feature: "other-feature", tasks: [] },
  '"feature" is "other-feature", not "task-coordination"',
  "task-coordination"
);
acceptsTasks(
  "feature key matching the slug is fine",
  { feature: "task-coordination", tasks: [] },
  "task-coordination"
);

for (const field of ["id", "title", "status", "acceptance"]) {
  const t = validTask();
  delete t[field];
  rejectsTasks(`task missing ${field}`, { tasks: [t] }, `tasks[0].${field}`);
  rejectsTasks(
    `task with blank ${field}`,
    { tasks: [validTask({ [field]: "  " })] },
    `tasks[0].${field}`
  );
}

rejectsTasks(
  "unknown task status",
  { tasks: [validTask({ status: "done", evidence: "x" }), validTask({ id: "t2", status: "wontfix" })] },
  `is not one of ${TASK_STATUSES.join("|")}`
);
for (const status of TASK_STATUSES) {
  const over = { status };
  if (status === "done") over.evidence = "proof";
  if (status === "claimed") {
    over.owner = "worker-a";
    over.claimed_at = "2026-08-06T22:00:00.000Z";
  }
  acceptsTasks(`task status ${status} accepted`, { tasks: [validTask(over)] });
}

rejectsTasks(
  "duplicate task id",
  { tasks: [validTask(), validTask({ title: "Another" })] },
  "is not unique"
);

rejectsTasks(
  "depends_on not an array",
  { tasks: [validTask({ depends_on: "t0" })] },
  "depends_on must be an array"
);
rejectsTasks(
  "depends_on entry not a string",
  { tasks: [validTask({ depends_on: [1] })] },
  "depends_on[0]"
);
rejectsTasks(
  "files entry empty",
  { tasks: [validTask({ files: [""] })] },
  "files[0]"
);
rejectsTasks(
  "depends_on names an id that does not exist in this file",
  { tasks: [validTask({ depends_on: ["ghost"] })] },
  'depends_on[0] "ghost" does not name a task in this file'
);
acceptsTasks(
  "depends_on may reference a task declared LATER in the array",
  {
    tasks: [
      validTask({ id: "t1", depends_on: ["t2"] }),
      validTask({ id: "t2", title: "Later", depends_on: [] }),
    ],
  }
);

rejectsTasks(
  "evidence missing when status is done",
  { tasks: [validTask({ status: "done" })] },
  'evidence is required when status is "done"'
);
rejectsTasks(
  "evidence blank when status is done",
  { tasks: [validTask({ status: "done", evidence: "  " })] },
  'evidence is required when status is "done"'
);

rejectsTasks(
  "owner missing when status is claimed",
  { tasks: [validTask({ status: "claimed", claimed_at: "2026-08-06T22:00:00.000Z" })] },
  'owner is required when status is "claimed"'
);
rejectsTasks(
  "claimed_at missing when status is claimed",
  { tasks: [validTask({ status: "claimed", owner: "worker-a" })] },
  'claimed_at is required when status is "claimed"'
);

rejectsTasks(
  "receipt.commit that is not a hex object id",
  { tasks: [validTask({ receipt: { commit: "HEAD" } })] },
  "is not a hex object id"
);
rejectsTasks(
  "receipt is not an object",
  { tasks: [validTask({ receipt: "abc1234" })] },
  "receipt must be an object"
);
acceptsTasks("receipt with a real hex commit is fine", {
  tasks: [validTask({ receipt: { commit: "6b900dd", verified_by: "worker-a" } })],
});

// --- depends_on cycles: one message naming both ends ------------------------
rejectsTasks(
  "a direct two-node cycle",
  {
    tasks: [
      validTask({ id: "t1", depends_on: ["t2"] }),
      validTask({ id: "t2", title: "Two", depends_on: ["t1"] }),
    ],
  },
  "depends_on cycle:"
);
{
  const msg = validateTasksShape({
    tasks: [
      validTask({ id: "t1", depends_on: ["t2"] }),
      validTask({ id: "t2", title: "Two", depends_on: ["t1"] }),
    ],
  });
  assertions++;
  if (!/^tasks depends_on cycle: t1 -> t2 -> t1$/.test(msg))
    failures.push(`two-node cycle message does not name both ends verbatim — got "${msg}"`);
}
rejectsTasks(
  "a self-cycle (a task depending on itself)",
  { tasks: [validTask({ id: "t1", depends_on: ["t1"] })] },
  "depends_on cycle: t1 -> t1"
);
rejectsTasks(
  "a three-node cycle",
  {
    tasks: [
      validTask({ id: "t1", depends_on: ["t2"] }),
      validTask({ id: "t2", title: "Two", depends_on: ["t3"] }),
      validTask({ id: "t3", title: "Three", depends_on: ["t1"] }),
    ],
  },
  "depends_on cycle:"
);
acceptsTasks("a DAG (no cycle) is accepted", {
  tasks: [
    validTask({ id: "t1", depends_on: ["t2", "t3"] }),
    validTask({ id: "t2", title: "Two", depends_on: ["t3"] }),
    validTask({ id: "t3", title: "Three", depends_on: [] }),
  ],
});

// --- unblockedTasks: respects dependencies, empty on a cycle ----------------
{
  const data = {
    tasks: [
      validTask({ id: "t1", title: "Ready", depends_on: [] }),
      validTask({ id: "t2", title: "Waiting", depends_on: ["t3"] }),
      validTask({ id: "t3", title: "Not done yet", status: "open", depends_on: [] }),
      validTask({ id: "t4", title: "Claimed", status: "claimed", owner: "w", claimed_at: "x" }),
    ],
  };
  const unblocked = unblockedTasks(data).map((t) => t.id);
  ok("unblockedTasks returns the open task with no unmet deps", unblocked.includes("t1"), unblocked.join(","));
  ok(
    "unblockedTasks EXCLUDES an open task waiting on an undone dependency",
    !unblocked.includes("t2"),
    unblocked.join(",")
  );

  // Same shape, but t3 is now done — t2 becomes unblocked.
  const unblockedAfter = unblockedTasks({
    tasks: [
      validTask({ id: "t1", title: "Ready", depends_on: [] }),
      validTask({ id: "t2", title: "Waiting", depends_on: ["t3"] }),
      validTask({ id: "t3", title: "Done", status: "done", evidence: "shipped" }),
    ],
  }).map((t) => t.id);
  ok(
    "unblockedTasks includes an open task once its dependency is done",
    unblockedAfter.includes("t2"),
    unblockedAfter.join(",")
  );
}
{
  const cyclic = {
    tasks: [
      validTask({ id: "t1", depends_on: ["t2"] }),
      validTask({ id: "t2", title: "Two", depends_on: ["t1"] }),
    ],
  };
  ok(
    "unblockedTasks returns [] on a cyclic list, never a partial guess",
    Array.isArray(unblockedTasks(cyclic)) && unblockedTasks(cyclic).length === 0,
    JSON.stringify(unblockedTasks(cyclic))
  );
}
ok("unblockedTasks handles a missing tasks.json (null data)", unblockedTasks({ data: null }) instanceof Array);
ok("unblockedTasks on null is []", unblockedTasks(null).length === 0);

// ---------------------------------------------------------------------------
// 12. Compare-and-swap read/write for tasks.json
// ---------------------------------------------------------------------------

{
  const brain = path.join(tmpRoot, "cas", ".brain");
  fs.mkdirSync(path.join(brain, "features", "widget"), { recursive: true });

  // An absent tasks.json is legal — read-compat, not an error.
  const absent = readTasks(brain, "widget");
  ok("readTasks on an absent file returns data:null", absent.data === null);
  ok("readTasks on an absent file returns hash:null", absent.hash === null);

  // Creating a brand-new file: expectedHash === null must succeed when none
  // exists yet.
  const created = writeTasksCas(brain, "widget", validTasks, null);
  ok("CAS write creates a new file when expectedHash is null and none exists", created.ok === true, JSON.stringify(created));
  ok("tasksPath points at the file CAS actually wrote", fs.existsSync(tasksPath(brain, "widget")));

  // A second create attempt with expectedHash still null must now refuse — a
  // file has since appeared, which is exactly the race CAS exists to catch.
  const raced = writeTasksCas(brain, "widget", validTasks, null);
  ok("a second create with expectedHash:null is refused once a file exists", raced.ok === false, JSON.stringify(raced));

  // Read it back, get the real hash, and write with a matching hash: succeeds.
  const read1 = readTasks(brain, "widget");
  ok("readTasks reads back the just-written file", read1.data && read1.data.feature === "task-coordination");
  ok("readTasks hash is a sha256 hex digest", /^[0-9a-f]{64}$/.test(read1.hash), read1.hash);

  const updated = { ...read1.data, tasks: [validTask({ status: "claimed", owner: "w", claimed_at: "now" })] };
  const casOk = writeTasksCas(brain, "widget", updated, read1.hash);
  ok("CAS write succeeds when the hash matches", casOk.ok === true, JSON.stringify(casOk));
  ok(
    "the write actually landed the new content",
    JSON.parse(fs.readFileSync(tasksPath(brain, "widget"), "utf8")).tasks[0].status === "claimed"
  );

  // Simulate the race the CAS exists to prevent: read, then have ANOTHER
  // writer mutate the file, then attempt to write against the now-stale hash.
  const read2 = readTasks(brain, "widget");
  const raceBytes = fs.readFileSync(tasksPath(brain, "widget"), "utf8");
  // A concurrent worker lands its own change in between.
  fs.writeFileSync(
    tasksPath(brain, "widget"),
    JSON.stringify({ ...read2.data, tasks: [validTask({ id: "intruder" })] }, null, 2) + "\n"
  );
  const intrudedBytes = fs.readFileSync(tasksPath(brain, "widget"), "utf8");
  ok(
    "fixture sanity: the simulated concurrent write actually changed the bytes",
    intrudedBytes !== raceBytes
  );

  const refused = writeTasksCas(
    brain,
    "widget",
    { ...read2.data, tasks: [validTask({ id: "loser" })] },
    read2.hash
  );
  ok("a CAS write against a stale hash is refused", refused.ok === false, JSON.stringify(refused));
  ok("a refused CAS write never throws — it reports", typeof refused === "object" && refused !== null);
  ok(
    "a refused CAS write leaves the file BYTE-IDENTICAL to the intruder's write",
    fs.readFileSync(tasksPath(brain, "widget"), "utf8") === intrudedBytes,
    "the file was modified by a refused CAS write"
  );

  // ---------------------------------------------------------------------------
  // The assertions above simulate the race SEQUENTIALLY — the intruder's write
  // fully lands before writeTasksCas is even called. That is not the race. It
  // never opens the window between the hash comparison and the rename, so it
  // passed against an implementation where two REAL concurrent processes both
  // won and one claim was silently discarded (reproduced 5/5 before the lock
  // was added). A sequential simulation of a concurrency bug proves nothing
  // about concurrency; this spawns actual OS processes instead.
  // ---------------------------------------------------------------------------
  {
    const raceBrain = path.join(tmpRoot, "race", ".brain");
    fs.mkdirSync(path.join(raceBrain, "features", "demo"), { recursive: true });
    const claimer = path.join(tmpRoot, "race", "claim.mjs");
    const stateUrl = new URL("../lib/state.js", import.meta.url).href;
    fs.writeFileSync(
      claimer,
      `import { readTasks, writeTasksCas } from ${JSON.stringify(stateUrl)};\n` +
        `const [brain, owner, delay] = process.argv.slice(2);\n` +
        `const { data, hash } = readTasks(brain, "demo");\n` +
        // Widen the window the way real work does: a CLI parses, validates and
        // builds output between its read and its write.
        `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(delay));\n` +
        `data.tasks[0].status = "claimed";\n` +
        `data.tasks[0].owner = owner;\n` +
        `data.tasks[0].claimed_at = new Date().toISOString();\n` +
        `const r = writeTasksCas(brain, "demo", data, hash);\n` +
        `console.log(r.ok ? "WON" : "refused");\n`
    );

    const contested = {
      updated: "2026-08-06",
      feature: "demo",
      tasks: [{ id: "t1", title: "contested", status: "open", acceptance: "one winner only" }],
    };

    let winners = 0;
    let refusals = 0;
    let lockLeaks = 0;
    const TRIALS = 5;
    for (let i = 0; i < TRIALS; i++) {
      fs.writeFileSync(tasksPath(raceBrain, "demo"), JSON.stringify(contested, null, 2) + "\n");
      const run = spawnSync(
        "sh",
        [
          "-c",
          `node ${JSON.stringify(claimer)} ${JSON.stringify(raceBrain)} worker-a 40 & ` +
            `node ${JSON.stringify(claimer)} ${JSON.stringify(raceBrain)} worker-b 40 & wait`,
        ],
        { encoding: "utf8" }
      );
      const out = run.stdout || "";
      winners += (out.match(/WON/g) || []).length;
      refusals += (out.match(/refused/g) || []).length;
      if (fs.existsSync(`${tasksPath(raceBrain, "demo")}.lock`)) lockLeaks++;
    }

    ok(
      `exactly one of two concurrent claimers wins, every trial (${TRIALS} trials)`,
      winners === TRIALS,
      `expected ${TRIALS} winners across ${TRIALS} trials, got ${winners} — a second winner means a lost claim`
    );
    ok(
      "the loser is refused rather than silently overwriting the winner",
      refusals === TRIALS,
      `expected ${TRIALS} refusals, got ${refusals}`
    );
    ok(
      "the lock file is always released, never leaked",
      lockLeaks === 0,
      `${lockLeaks} trial(s) left a .lock behind`
    );
  }

  // ---------------------------------------------------------------------------
  // The stale-lock STEAL path. Every claimer above finishes in milliseconds, so
  // none of them can approach LOCK_STALE_MS — meaning the age-based breaker and
  // the ownership rules had no coverage at all, only prose in a commit message.
  // Adversarial review then broke exactly that gap: a holder whose section
  // overran the threshold had its lock stolen, and its own cleanup deleted the
  // THIEF's live lock, letting a third process in. Two processes in one critical
  // section — the failure the lock exists to prevent.
  //
  // These assert the two rules that close it: a stolen-from holder writes
  // nothing, and a holder releases only its own lock.
  // ---------------------------------------------------------------------------
  {
    const brain = path.join(tmpRoot, "lock-steal", ".brain");
    fs.mkdirSync(path.join(brain, "features", "demo"), { recursive: true });
    const file = tasksPath(brain, "demo");
    const lockPath = `${file}.lock`;
    const seed = {
      updated: "2026-08-06",
      feature: "demo",
      tasks: [{ id: "t1", title: "contested", status: "open", acceptance: "one winner only" }],
    };
    fs.writeFileSync(file, JSON.stringify(seed, null, 2) + "\n");
    const before = fs.readFileSync(file, "utf8");

    const { data, hash } = readTasks(brain, "demo");
    data.tasks[0].status = "claimed";
    data.tasks[0].owner = "victim";
    data.tasks[0].claimed_at = "2026-08-06T00:00:00.000Z";

    // Steal the lock while the victim is INSIDE its critical section: fire right
    // after it reads tasks.json for the hash compare, i.e. before its final
    // ownership check. This is what a breaker does to a live holder.
    const realRead = fs.readFileSync;
    let stolen = false;
    fs.readFileSync = function (p, ...rest) {
      const out = realRead.call(fs, p, ...rest);
      if (!stolen && String(p) === file) {
        stolen = true;
        fs.writeFileSync(lockPath, "thief-token");
      }
      return out;
    };
    let stolenFrom;
    try {
      stolenFrom = writeTasksCas(brain, "demo", data, hash);
    } finally {
      fs.readFileSync = realRead;
    }

    ok("fixture sanity: the lock was actually stolen mid-section", stolen);
    ok(
      "a holder whose lock was stolen mid-section REFUSES instead of writing",
      stolenFrom.ok === false,
      JSON.stringify(stolenFrom)
    );
    ok(
      "the refusal names the lock as the reason, not a stale hash",
      stolenFrom.reason === "lock-lost",
      `reason was ${stolenFrom.reason}`
    );
    ok(
      "a stolen-from holder leaves tasks.json BYTE-IDENTICAL",
      fs.readFileSync(file, "utf8") === before,
      "the stolen-from holder wrote anyway — two winners are possible"
    );
    ok(
      "a holder releases only its OWN lock, never the thief's live one",
      fs.existsSync(lockPath) && realRead.call(fs, lockPath, "utf8") === "thief-token",
      "the victim's cleanup deleted a lock it did not own"
    );

    // And the breaker must still work, or a SIGKILLed holder wedges the feature
    // forever — the reason stealing exists at all.
    fs.writeFileSync(lockPath, "dead-holder");
    const stale = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(lockPath, stale, stale);
    const afterDead = readTasks(brain, "demo");
    const recovered = writeTasksCas(
      brain,
      "demo",
      { ...afterDead.data, updated: "2026-08-07" },
      afterDead.hash
    );
    ok(
      "an abandoned lock older than LOCK_STALE_MS is broken, not deadlocked on",
      recovered.ok === true,
      JSON.stringify(recovered)
    );
    ok("breaking a stale lock still releases it afterwards", !fs.existsSync(lockPath));
  }
}

// ---------------------------------------------------------------------------
// 13. `brain tasks` — the CLI surface over lib/state.js's task layer. Section
// 11 above proves the shape validator and section 12 proves the CAS primitive
// in isolation; this section proves the CLI WIRES them together correctly:
// required flags refuse at exit 2, mutations preflight-then-commit, no-ops
// are idempotent at exit 0, and a CAS refusal reaching THIS code path still
// leaves the file untouched.
// ---------------------------------------------------------------------------

{
  const brain = makeBrain("tasks-cli", { features: [featureFor("widget")] });
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args, "--brain", brain], { encoding: "utf8" });

  // --- definitive empty state (§5) -----------------------------------------
  const emptyList = run("tasks", "widget");
  ok("tasks list on a feature with no tasks.json exits 0", emptyList.status === 0, emptyList.stdout);
  ok(
    "tasks list gives the exact definitive empty-state line",
    /^tasks: no tasks for widget yet$/m.test(emptyList.stdout || ""),
    emptyList.stdout
  );

  // --- required-flag refusals (exit 2) -------------------------------------
  const noTitle = run("tasks", "add", "widget", "--acceptance", "x");
  ok("tasks add without --title refuses at exit 2", noTitle.status === 2, noTitle.stdout);
  ok("the message names --title", /--title/.test(noTitle.stdout || ""), noTitle.stdout);

  const noAcceptance = run("tasks", "add", "widget", "--title", "Thing");
  ok("tasks add without --acceptance refuses at exit 2", noAcceptance.status === 2, noAcceptance.stdout);
  ok("the message names --acceptance", /--acceptance/.test(noAcceptance.stdout || ""), noAcceptance.stdout);

  const unknownFlag = run("tasks", "add", "widget", "--title", "x", "--acceptance", "y", "--bogus", "z");
  ok("tasks add rejects an unknown flag at exit 2", unknownFlag.status === 2, unknownFlag.stdout);
  ok(
    "the unknown-flag error lists this subcommand's valid flags inline",
    /valid flags for `tasks add`/.test(unknownFlag.stdout || ""),
    unknownFlag.stdout
  );

  // Now actually build a small task graph via the CLI (never the live .brain/).
  const addT1 = run("tasks", "add", "widget", "--title", "The record", "--acceptance", "schema exists");
  ok("tasks add (first task) exits 0", addT1.status === 0, addT1.stdout);
  ok("first task auto-generates id t1", /\bid: t1\b/.test(addT1.stdout || ""), addT1.stdout);

  const addT2 = run(
    "tasks", "add", "widget",
    "--title", "The gate",
    "--acceptance", "check rows exist",
    "--depends-on", "t1"
  );
  ok("tasks add (second task, depends on t1) exits 0", addT2.status === 0, addT2.stdout);
  ok("second task auto-generates id t2", /\bid: t2\b/.test(addT2.stdout || ""), addT2.stdout);

  const listing = run("tasks", "widget");
  ok(
    "count line includes the pre-computed unblocked aggregate (§4)",
    /count: "2 tasks — 2 open \(1 unblocked\)"/.test(listing.stdout || ""),
    listing.stdout
  );

  const noOwner = run("tasks", "claim", "widget", "t1");
  ok("tasks claim without --owner refuses at exit 2", noOwner.status === 2, noOwner.stdout);

  const noEvidence = run("tasks", "done", "widget", "t1");
  ok("tasks done without --evidence refuses at exit 2", noEvidence.status === 2, noEvidence.stdout);
  const blankEvidence = run("tasks", "done", "widget", "t1", "--evidence", "   ");
  ok("tasks done with blank --evidence refuses at exit 2", blankEvidence.status === 2, blankEvidence.stdout);

  // --- dependency-gated claim refusal ---------------------------------------
  const claimBlocked = run("tasks", "claim", "widget", "t2", "--owner", "worker-a");
  ok("claiming a task whose dependency is not done refuses at exit 1", claimBlocked.status === 1, claimBlocked.stdout);
  ok("the refusal names the unmet dependency", /blocked on t1/.test(claimBlocked.stdout || ""), claimBlocked.stdout);

  // --- claim, idempotent re-claim, claim-conflict ---------------------------
  const claim1 = run("tasks", "claim", "widget", "t1", "--owner", "worker-a");
  ok("claiming an open, unblocked task exits 0", claim1.status === 0, claim1.stdout);

  const reClaimSame = run("tasks", "claim", "widget", "t1", "--owner", "worker-a");
  ok("re-claiming your own claim is an idempotent no-op at exit 0 (§6)", reClaimSame.status === 0, reClaimSame.stdout);
  ok("the no-op says so explicitly", /no-op/.test(reClaimSame.stdout || ""), reClaimSame.stdout);

  const claimConflict = run("tasks", "claim", "widget", "t1", "--owner", "worker-b");
  ok("claiming a task held by someone else refuses at exit 1", claimConflict.status === 1, claimConflict.stdout);
  ok(
    "the conflict names the CURRENT owner, not the caller",
    /already claimed by "worker-a"/.test(claimConflict.stdout || ""),
    claimConflict.stdout
  );

  // --- done: idempotent no-op, then unblocks the dependent task -------------
  const done1 = run("tasks", "done", "widget", "t1", "--evidence", "check-state-invariants green");
  ok("tasks done with real evidence exits 0", done1.status === 0, done1.stdout);

  const bytesAfterDone = fs.readFileSync(tasksPath(brain, "widget"), "utf8");
  const done1Again = run("tasks", "done", "widget", "t1", "--evidence", "a different string, ignored");
  ok("closing an already-done task is an idempotent no-op at exit 0 (§6)", done1Again.status === 0, done1Again.stdout);
  ok("the no-op says so explicitly", /already done \(no-op\)/.test(done1Again.stdout || ""), done1Again.stdout);
  ok(
    "a no-op `done` does NOT overwrite the original evidence",
    fs.readFileSync(tasksPath(brain, "widget"), "utf8") === bytesAfterDone,
    "the file changed even though the operation was reported as a no-op"
  );

  const claimT2 = run("tasks", "claim", "widget", "t2", "--owner", "worker-a");
  ok("t2 becomes claimable once its dependency (t1) is done", claimT2.status === 0, claimT2.stdout);

  // A DONE task cannot be released — release is the stale-CLAIM escape hatch,
  // not a generic status un-doer.
  const releaseDone = run("tasks", "release", "widget", "t1");
  ok("releasing a done task refuses (only a claimed task is releasable)", releaseDone.status === 1, releaseDone.stdout);

  // Add a fresh unclaimed task to exercise the "already open" no-op path.
  const addT3 = run("tasks", "add", "widget", "--title", "The handoff", "--acceptance", "brief composes");
  ok("tasks add (third task) exits 0", addT3.status === 0, addT3.stdout);
  const releaseAlreadyOpen = run("tasks", "release", "widget", "t3");
  ok("releasing an already-open task is an idempotent no-op at exit 0 (§6)", releaseAlreadyOpen.status === 0, releaseAlreadyOpen.stdout);
  ok("the no-op says so explicitly", /already open \(no-op\)/.test(releaseAlreadyOpen.stdout || ""), releaseAlreadyOpen.stdout);

  // Real release: t2 is claimed by worker-a — clear it back to open.
  const release2 = run("tasks", "release", "widget", "t2");
  ok("releasing a claimed task exits 0", release2.status === 0, release2.stdout);
  const afterRelease = JSON.parse(fs.readFileSync(tasksPath(brain, "widget"), "utf8"));
  const t2AfterRelease = afterRelease.tasks.find((t) => t.id === "t2");
  ok("release clears status back to open", t2AfterRelease.status === "open", JSON.stringify(t2AfterRelease));
  ok("release clears owner", t2AfterRelease.owner === undefined, JSON.stringify(t2AfterRelease));
  ok("release clears claimed_at", t2AfterRelease.claimed_at === undefined, JSON.stringify(t2AfterRelease));
  const reClaimT2 = run("tasks", "claim", "widget", "t2", "--owner", "worker-b");
  ok("a released task is claimable by a DIFFERENT owner", reClaimT2.status === 0, reClaimT2.stdout);

  // --- the CAS refusal path reaching the CLI's own error plumbing, leaving
  // the file byte-identical. Sections 11/12 above prove the primitive in
  // isolation; this proves it on a file this CLI's OWN write path produced,
  // and that cmdTasksClaim's own opError wiring (not just writeTasksCas
  // itself) reports it and touches nothing.
  const beforeForge = readTasks(brain, "widget");
  const intruderWrite = writeTasksCas(
    brain,
    "widget",
    { ...beforeForge.data, updated: "2026-08-06", tasks: beforeForge.data.tasks.map((t) => (t.id === "t3" ? { ...t, status: "claimed", owner: "intruder", claimed_at: new Date().toISOString() } : t)) },
    beforeForge.hash
  );
  ok("fixture: the simulated concurrent writer's own CAS write succeeds", intruderWrite.ok === true, JSON.stringify(intruderWrite));
  const intrudedBytes2 = fs.readFileSync(tasksPath(brain, "widget"), "utf8");

  // A worker still holding the PRE-intrusion hash attempts its own CAS write
  // directly (the exact call cmdTasksClaim makes) with the now-stale hash.
  const staleAttempt = writeTasksCas(
    brain,
    "widget",
    { ...beforeForge.data, updated: "2026-08-06", tasks: beforeForge.data.tasks.map((t) => (t.id === "t3" ? { ...t, status: "claimed", owner: "loser", claimed_at: new Date().toISOString() } : t)) },
    beforeForge.hash
  );
  ok("a stale writer against a CLI-produced file is refused", staleAttempt.ok === false, JSON.stringify(staleAttempt));
  ok(
    "the refused write leaves the CLI-produced file BYTE-IDENTICAL to the intruder's write",
    fs.readFileSync(tasksPath(brain, "widget"), "utf8") === intrudedBytes2,
    "the file changed even though the write was refused"
  );

  // And the CLI itself, asked to claim the now-intruded t3 as yet another
  // owner, refuses too — via the ordinary "already claimed" business check,
  // since the CLI always re-reads fresh (a second call, not a stale hash).
  const claimAfterIntrusion = run("tasks", "claim", "widget", "t3", "--owner", "worker-c");
  ok("the CLI sees the intruder's write on its next read and refuses too", claimAfterIntrusion.status === 1, claimAfterIntrusion.stdout);
  ok(
    "naming the intruder as the current owner",
    /already claimed by "intruder"/.test(claimAfterIntrusion.stdout || ""),
    claimAfterIntrusion.stdout
  );
}

// ---------------------------------------------------------------------------
// 14. The gate wired end to end: `brain ship` / `set-status shipped` refuse on
// an open task (through the SAME scoped brainCheck preflight, no special
// case), and gated autoship (`tasks done` closing the LAST open task) runs
// that identical preflight automatically. `--no-autoship` opts out.
//
// Per the warning learned this session: a refusal is only proven by asserting
// the OBSERVABLE STATE AFTER it (bytes unchanged, status unchanged) — not
// merely that a message containing "refused" appeared.
// ---------------------------------------------------------------------------

function runIn(brain, ...args) {
  return spawnSync(process.execPath, [CLI, ...args, "--brain", brain], { encoding: "utf8" });
}

function writeOneOpenTask(brain, slug, id = "t1") {
  fs.writeFileSync(
    tasksPath(brain, slug),
    JSON.stringify(
      { feature: slug, tasks: [{ id, title: "the only task", status: "open", acceptance: "it works" }] },
      null,
      2
    )
  );
}

{
  // `brain ship` refuses when the feature has an open task — through the
  // ordinary scoped brainCheck preflight, no code change to cmdShip needed.
  const brain = makeBrain(
    "ship-open-task",
    { features: [featureFor("gated", { status: "in-progress" })] },
    { verdictDoc: PASS_DOC }
  );
  writeOneOpenTask(brain, "gated");
  const flPath = path.join(brain, "features", "feature_list.json");
  const before = fs.readFileSync(flPath, "utf8");

  const refused = runIn(brain, "ship", "gated", "--evidence", "should be refused");
  ok("ship refuses when the feature has an open task", refused.status === 1, refused.stdout);
  ok(
    "...naming the gate that refused it",
    /no shipped feature has an open task/.test(refused.stdout || ""),
    refused.stdout
  );
  ok(
    "...and naming the open task id",
    /gated: t1/.test(refused.stdout || ""),
    refused.stdout
  );
  ok(
    "a refused ship leaves feature_list.json byte-identical",
    fs.readFileSync(flPath, "utf8") === before,
    "feature_list.json changed even though the ship was refused"
  );

  // `features set-status --status shipped` runs the identical preflight.
  const refusedSetStatus = runIn(brain, "features", "set-status", "gated", "--status", "shipped", "--evidence", "nope");
  ok("set-status shipped refuses on the same open task", refusedSetStatus.status === 1, refusedSetStatus.stdout);
  ok(
    "set-status's refusal ALSO leaves feature_list.json byte-identical",
    fs.readFileSync(flPath, "utf8") === before,
    "feature_list.json changed even though set-status was refused"
  );

  // Close the task (opting OUT of autoship here — that path is proven on its
  // own fixtures below) and confirm the SAME feature now ships cleanly, so the
  // gate is proven to open, not merely to always refuse.
  const closed = runIn(brain, "tasks", "done", "gated", "t1", "--evidence", "closed", "--no-autoship");
  ok("closing the task exits 0", closed.status === 0, closed.stdout);
  const shipsNow = runIn(brain, "ship", "gated", "--evidence", "now unblocked");
  ok("the SAME feature ships once its task is closed", shipsNow.status === 0, shipsNow.stdout);
}

{
  // Gated autoship — the happy path: closing the LAST open task on an already
  // verified feature ships it automatically, through the identical strict
  // preflight (a PASS verdict doc is present, so it clears).
  const brain = makeBrain(
    "autoship-ok",
    { features: [featureFor("autoship-ok", { status: "in-progress" })] },
    { verdictDoc: PASS_DOC }
  );
  writeOneOpenTask(brain, "autoship-ok");
  const flPath = path.join(brain, "features", "feature_list.json");

  const res = runIn(brain, "tasks", "done", "autoship-ok", "t1", "--evidence", "verified and done");
  ok("autoship on a verified feature exits 0", res.status === 0, res.stdout);
  ok("the task-close is reported", /status: done/.test(res.stdout || ""), res.stdout);
  ok("the ship is reported in the SAME output", /^ship:$/m.test(res.stdout || ""), res.stdout);
  ok("...and reports shipped", /status: shipped/.test(res.stdout || ""), res.stdout);

  const after = JSON.parse(fs.readFileSync(flPath, "utf8")).features[0];
  ok("autoship actually flipped the feature to shipped on disk", after.status === "shipped", after.status);
  const tasksAfter = JSON.parse(fs.readFileSync(tasksPath(brain, "autoship-ok"), "utf8"));
  ok("the task is done on disk", tasksAfter.tasks[0].status === "done", JSON.stringify(tasksAfter.tasks[0]));
}

{
  // Gated autoship — the refusal: no PASS verification bound to a commit, so
  // the strict preflight refuses. The task close ALREADY SUCCEEDED (it is not
  // rolled back), and the feature is left untouched — asserted by BYTES, not
  // merely by re-reading a status field a broken implementation could also
  // get right by accident.
  const brain = makeBrain("autoship-refused", {
    features: [featureFor("autoship-refused", { status: "in-progress" })],
  }); // no verdictDoc — nothing to prove strict with
  writeOneOpenTask(brain, "autoship-refused");
  const flPath = path.join(brain, "features", "feature_list.json");
  const beforeFl = fs.readFileSync(flPath, "utf8");

  const res = runIn(brain, "tasks", "done", "autoship-refused", "t1", "--evidence", "done but unverified");
  ok(
    "a refused autoship still exits 0 — the task close (the primary, already-committed operation) succeeded",
    res.status === 0,
    `exit ${res.status}: ${res.stdout}`
  );
  ok("the output says the task closed", /status: done/.test(res.stdout || ""), res.stdout);
  ok("...AND that the ship was refused", /ship: refused/.test(res.stdout || ""), res.stdout);

  ok(
    "the feature_list.json is BYTE-IDENTICAL after a refused autoship",
    fs.readFileSync(flPath, "utf8") === beforeFl,
    "feature_list.json changed even though the autoship was refused"
  );
  const after = JSON.parse(fs.readFileSync(flPath, "utf8")).features[0];
  ok("the feature status is unchanged (still in-progress)", after.status === "in-progress", after.status);
  const tasksAfter = JSON.parse(fs.readFileSync(tasksPath(brain, "autoship-refused"), "utf8"));
  ok(
    "the task is STILL closed despite the ship refusal (the close is not rolled back)",
    tasksAfter.tasks[0].status === "done",
    JSON.stringify(tasksAfter.tasks[0])
  );
}

{
  // `--no-autoship` opts out entirely: closing the last task on a feature that
  // WOULD otherwise ship cleanly must not trigger a ship attempt at all.
  const brain = makeBrain(
    "autoship-optout",
    { features: [featureFor("autoship-optout", { status: "in-progress" })] },
    { verdictDoc: PASS_DOC }
  );
  writeOneOpenTask(brain, "autoship-optout");
  const flPath = path.join(brain, "features", "feature_list.json");
  const beforeFl = fs.readFileSync(flPath, "utf8");

  const res = runIn(brain, "tasks", "done", "autoship-optout", "t1", "--evidence", "done", "--no-autoship");
  ok("--no-autoship exits 0", res.status === 0, res.stdout);
  ok("--no-autoship never attempts a ship", !/^ship:$/m.test(res.stdout || ""), res.stdout);
  ok("--no-autoship says autoship was skipped", /autoship skipped/.test(res.stdout || ""), res.stdout);
  ok(
    "--no-autoship leaves feature_list.json byte-identical",
    fs.readFileSync(flPath, "utf8") === beforeFl,
    "feature_list.json changed even though autoship was opted out"
  );
}

// ---------------------------------------------------------------------------
// 15. `brain brief <slug> <task-id>` — the handoff payload: task + acceptance
// + approved decisions from plans/<slug>/reviews.jsonl + the rules docs
// owning the task's declared files. Covers: decisions + owning rules present,
// neither present (still definitive, never silently empty), unknown
// task/slug (clean exit 1), truncation + --full, and the files->rules
// derivation from rules/index.md's Touches column.
// ---------------------------------------------------------------------------

function writeRulesIndex(brain, tableBody) {
  fs.mkdirSync(path.join(brain, "rules"), { recursive: true });
  fs.writeFileSync(
    path.join(brain, "rules", "index.md"),
    ["# Rules — Index", "", "| # | Rule | Touches | Read when |", "|---|------|---------|-----------|", ...tableBody, ""].join(
      "\n"
    )
  );
}

// A legacy (unbound) plan whose OWN slug equals the feature slug — the same
// shape this repo's own task-coordination plan is in, and the shape brief
// must recognize as "this feature's plan" without an explicit --feature bind.
function writePlanWithDecision(brain, slug, { decisionPrompt, tag = "decision", endedBy = "user" } = {}) {
  const dir = path.join(brain, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify(
      { slug, title: slug, file: path.join(dir, "v1.html"), feature: null, status: "reviewed", created: now, updated: now, rounds: 1 },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(dir, "reviews.jsonl"),
    JSON.stringify({ at: now, round: 1, prompts: [{ tag, selector: "", text: "", prompt: decisionPrompt }], ended_by: endedBy }) + "\n"
  );
  fs.writeFileSync(path.join(dir, "v1.html"), `<title>${slug}</title>`);
}

function writeTasksFile(brain, slug, tasks) {
  fs.mkdirSync(path.dirname(tasksPath(brain, slug)), { recursive: true });
  fs.writeFileSync(tasksPath(brain, slug), JSON.stringify({ feature: slug, tasks }, null, 2));
}

{
  // The full case: decisions AND an owning rule both present, on the SAME
  // task, so a single fixture proves the whole composition rather than one
  // property at a time.
  const brain = makeBrain("brief-full", { features: [featureFor("briefme", { description: "does the thing" })] });
  writeTasksFile(brain, "briefme", [
    {
      id: "t1",
      title: "The task",
      status: "open",
      acceptance: "short acceptance text",
      files: ["bin/brain.js", "scripts/check-state-invariants.mjs"],
    },
  ]);
  writeRulesIndex(brain, ["| 2 | [`cli-commands.md`](cli-commands.md) | `bin/brain.js` commands, flags | Adding a command |"]);
  writePlanWithDecision(brain, "briefme", { decisionPrompt: "Should X happen?: Yes, verbatim decision text" });

  const res = runIn(brain, "brief", "briefme", "t1");
  ok("brief on a fully-populated task exits 0", res.status === 0, res.stdout);
  ok(
    "brief resolves bin/brain.js to cli-commands.md via rules/index.md's Touches column",
    /bin\/brain\.js,cli-commands\.md/.test(res.stdout || ""),
    res.stdout
  );
  ok(
    "brief says (none) for a declared file no rule's Touches column names",
    /scripts\/check-state-invariants\.mjs,\(none\)/.test(res.stdout || ""),
    res.stdout
  );
  ok(
    "brief cites the approved decision prompt VERBATIM",
    (res.stdout || "").includes("Should X happen?: Yes, verbatim decision text"),
    res.stdout
  );
  const helpBlockMatch = /help\[\d+\]:\n((?:.*\n?)*)/.exec(res.stdout || "");
  const firstHelpLine = helpBlockMatch ? helpBlockMatch[1].split("\n").find((l) => l.trim()) : "";
  ok(
    "...specifically: `tasks claim briefme t1 --owner <name>` is the first help line",
    /^\s*Run `brain tasks claim briefme t1 --owner <name>`/.test(firstHelpLine || ""),
    firstHelpLine
  );
}

{
  // Neither decisions nor an owning rule: still definitive, never a silently
  // empty section (AXI §5).
  const brain = makeBrain("brief-bare", { features: [featureFor("bare")] });
  writeTasksFile(brain, "bare", [{ id: "t1", title: "The task", status: "open", acceptance: "x", files: ["some/random/file.js"] }]);
  // Deliberately no rules/ dir and no plans/ dir at all.

  const res = runIn(brain, "brief", "bare", "t1");
  ok("brief on a task with neither decisions nor owning rules still exits 0", res.status === 0, res.stdout);
  ok(
    "decisions section says definitively there are none, not silently empty",
    /decisions: no plans bound to feature "bare"/.test(res.stdout || ""),
    res.stdout
  );
  ok(
    "rules_source says definitively that ownership cannot be derived",
    /rules_source: rules\/index\.md not found/.test(res.stdout || ""),
    res.stdout
  );
  ok(
    "the declared file with no owning rule reads (none), not blank",
    /some\/random\/file\.js,\(none\)/.test(res.stdout || ""),
    res.stdout
  );
}

{
  // Unknown task id and unknown slug — clean refusal, exit 1, not a crash.
  const brain = makeBrain("brief-bare-2", { features: [featureFor("bare2")] });
  writeTasksFile(brain, "bare2", [{ id: "t1", title: "The task", status: "open", acceptance: "x" }]);

  const badTask = runIn(brain, "brief", "bare2", "t99");
  ok("brief on an unknown task id exits 1", badTask.status === 1, badTask.stdout);
  ok("...naming the known ids", /known ids: t1/.test(badTask.stdout || ""), badTask.stdout);

  const badSlug = runIn(brain, "brief", "ghost-feature", "t1");
  ok("brief on an unknown feature slug (no tasks.json at all) exits 1", badSlug.status === 1, badSlug.stdout);
}

{
  // Truncation + --full: a long acceptance and a long decision prompt are
  // both truncated by default, both readable in full with --full — and the
  // assertion proves it by checking the FULL text is ABSENT by default and
  // PRESENT with --full, not merely that the word "truncated" appears.
  const longAcceptance = "A".repeat(1500);
  const longDecision = "Q".repeat(50) + ": " + "D".repeat(300);
  const brain = makeBrain("brief-truncate", { features: [featureFor("longone")] });
  writeTasksFile(brain, "longone", [{ id: "t1", title: "The task", status: "open", acceptance: longAcceptance, files: [] }]);
  writePlanWithDecision(brain, "longone", { decisionPrompt: longDecision });

  const short = runIn(brain, "brief", "longone", "t1");
  ok("brief without --full exits 0", short.status === 0, short.stdout);
  ok("...the full 1500-char acceptance is NOT present verbatim", !(short.stdout || "").includes(longAcceptance), "full acceptance leaked untruncated");
  ok("...the full long decision is NOT present verbatim", !(short.stdout || "").includes(longDecision), "full decision leaked untruncated");
  ok("...and it says so, pointing at --full", /Run `brain brief longone t1 --full`/.test(short.stdout || ""), short.stdout);

  const full = runIn(brain, "brief", "longone", "t1", "--full");
  ok("brief --full exits 0", full.status === 0, full.stdout);
  ok("...the full acceptance text IS present verbatim", (full.stdout || "").includes(longAcceptance), "full acceptance missing with --full");
  ok("...the full decision text IS present verbatim", (full.stdout || "").includes(longDecision), "full decision missing with --full");
}

// ---------------------------------------------------------------------------
// 16. `runs append --task/--author` — additive, optional, round-trip through
// `runs view`, and read-compat with a run note written before these existed.
// ---------------------------------------------------------------------------

{
  const brain = makeBrain("runs-task-author", { features: [featureFor("runsfeat")] });
  writeTasksFile(brain, "runsfeat", [{ id: "t1", title: "The task", status: "open", acceptance: "x" }]);

  const appended = runIn(
    brain,
    "runs",
    "append",
    "runsfeat",
    "--task",
    "t1",
    "--author",
    "worker-brief",
    "--step",
    "did a thing",
    "--observed",
    "VERBATIM_OBSERVED_OUTPUT_42"
  );
  ok("runs append --task --author exits 0", appended.status === 0, appended.stdout);
  ok("...reports the task in its own output", /task: t1/.test(appended.stdout || ""), appended.stdout);
  ok("...reports the author in its own output", /author: worker-brief/.test(appended.stdout || ""), appended.stdout);

  // Assert the OBSERVABLE STATE ON DISK, not just the confirmation message.
  const notesDir = path.join(brain, "features", "runsfeat", "runs");
  const noteFile = fs.readdirSync(notesDir).find((f) => f.endsWith(".md"));
  const onDisk = fs.readFileSync(path.join(notesDir, noteFile), "utf8");
  ok("the written note file contains the task metadata line", /^- task: t1$/m.test(onDisk), onDisk);
  ok("the written note file contains the author metadata line", /^- author: worker-brief$/m.test(onDisk), onDisk);
  ok("the written note file still contains the verbatim observed output", onDisk.includes("VERBATIM_OBSERVED_OUTPUT_42"), onDisk);

  const noteName = noteFile.replace(/\.md$/, "");
  const viewed = runIn(brain, "runs", "view", noteName, "--feature", "runsfeat");
  ok("runs view --feature exits 0", viewed.status === 0, viewed.stdout);
  ok("...surfaces the task id", /- task: t1/.test(viewed.stdout || ""), viewed.stdout);
  ok("...surfaces the author", /- author: worker-brief/.test(viewed.stdout || ""), viewed.stdout);
  ok("...surfaces the observed output", (viewed.stdout || "").includes("VERBATIM_OBSERVED_OUTPUT_42"), viewed.stdout);

  // runs append rejects an unknown --task id when tasks.json exists — and
  // WRITES NOTHING (checked by re-reading the note file, not just the exit
  // code — a refusal that still appended a step would be a real bug).
  const beforeRefusal = fs.readFileSync(path.join(notesDir, noteFile), "utf8");
  const badTask = runIn(brain, "runs", "append", "runsfeat", "--task", "t99", "--step", "x", "--observed", "y");
  ok("runs append with an unknown --task id refuses (exit 1)", badTask.status === 1, badTask.stdout);
  ok(
    "...and the run note file is byte-identical after the refusal",
    fs.readFileSync(path.join(notesDir, noteFile), "utf8") === beforeRefusal,
    "the note file changed even though runs append was refused"
  );

  // A run note written the OLD way (no task/author, hand-authored, predating
  // this feature entirely) must still parse and render through `runs view`.
  const legacyNote = "# runsfeat run — 2026-01-01\n\n## Step 1 — an old step\n\n```\nold observed output\n```\n";
  fs.writeFileSync(path.join(notesDir, "2026-01-01-progress.md"), legacyNote);
  const legacyView = runIn(brain, "runs", "view", "2026-01-01-progress", "--feature", "runsfeat");
  ok("a pre-existing run note with no task/author metadata still parses", legacyView.status === 0, legacyView.stdout);
  ok(
    "...and renders its body, including the old step, unaffected",
    (legacyView.stdout || "").includes("old observed output"),
    legacyView.stdout
  );

  // `runs` (list, no args) must surface the feature-scoped note at all — this
  // is the read-compat gap `runs append`/`runs view` used to have (append
  // wrote to features/<slug>/runs/, list/view only ever read the legacy
  // .brain/runs/ pool, so a note `runs append` wrote was invisible to `runs
  // view` from day one).
  const listed = runIn(brain, "runs");
  ok("brain runs (list) surfaces a feature-scoped run note", (listed.stdout || "").includes(noteName), listed.stdout);
}

// ---------------------------------------------------------------------------
// `progress add --summary` length gate
//
// progress.md has always documented a one-line summary; nothing enforced it, so
// entries grew into five-sentence paragraphs inside a heading. The gate refuses
// at the write boundary. Both sides of the boundary are exercised because a cap
// tested only from the failing side can be off by one in the direction that
// silently rejects legitimate input — and the refusal is checked to write
// NOTHING, since a partial write here corrupts the cursor every session reads.
// ---------------------------------------------------------------------------
{
  const brain = makeBrain("summary-gate", { features: [featureFor("alpha")] });
  const progress = path.join(brain, "runs", "progress.md");

  const atCap = runIn(brain, "progress", "add", "--summary", "y".repeat(SUMMARY_MAX_CHARS));
  ok("progress add accepts a summary exactly at the cap", atCap.status === 0, `exit ${atCap.status}: ${atCap.stdout}`);

  // Snapshot AFTER the accepted write, so the comparison below isolates the
  // refusals rather than folding in a legitimate change.
  const settled = fs.readFileSync(progress, "utf8");

  const overBy1 = runIn(brain, "progress", "add", "--summary", "z".repeat(SUMMARY_MAX_CHARS + 1));
  ok("progress add refuses one char over the cap", overBy1.status === 2, `exit ${overBy1.status}`);

  const wayOver = runIn(brain, "progress", "add", "--summary", "x".repeat(SUMMARY_MAX_CHARS * 3));
  ok("progress add refuses a paragraph-length summary", wayOver.status === 2, `exit ${wayOver.status}`);
  // The refusal has to teach the fix, not just deny: an agent that cannot see
  // where the detail belongs will retry with a slightly shorter paragraph.
  ok(
    "the refusal names the cap and points at runs append",
    /cap is \d+/.test(wayOver.stdout || "") && (wayOver.stdout || "").includes("runs append"),
    wayOver.stdout
  );

  ok(
    "two refused summaries leave progress.md byte-identical",
    fs.readFileSync(progress, "utf8") === settled,
    "a rejected entry reached the file"
  );

  // Astral characters must cost ONE each. `String.prototype.length` charges two
  // UTF-16 code units per emoji, so a summary of SUMMARY_MAX_CHARS emoji was
  // reported as double and refused at half the advertised cap — a gate that
  // rejects valid input is worse than no gate, because the caller cannot tell
  // whether the rule or their input is wrong. Found by pre-PR review.
  const emojiAtCap = runIn(brain, "progress", "add", "--summary", "🧠".repeat(SUMMARY_MAX_CHARS));
  ok(
    "the cap counts code points, not UTF-16 units (emoji at the cap is accepted)",
    emojiAtCap.status === 0,
    `exit ${emojiAtCap.status}: ${emojiAtCap.stdout}`
  );
  const emojiOver = runIn(brain, "progress", "add", "--summary", "🧠".repeat(SUMMARY_MAX_CHARS + 1));
  ok("the cap still refuses one code point over, in emoji", emojiOver.status === 2, `exit ${emojiOver.status}`);
  ok(
    "the emoji refusal reports the code-point count, not the UTF-16 length",
    new RegExp(`is ${SUMMARY_MAX_CHARS + 1} chars`).test(emojiOver.stdout || ""),
    emojiOver.stdout
  );

  const normal = runIn(brain, "progress", "add", "--summary", "wired the length gate", "--next", "run the suite");
  ok("progress add still accepts an ordinary summary", normal.status === 0, `exit ${normal.status}: ${normal.stdout}`);
  ok(
    "the accepted entry actually landed",
    fs.readFileSync(progress, "utf8").includes("wired the length gate"),
    "entry missing from progress.md"
  );
}

// ---------------------------------------------------------------------------
// Playbook registry — the two standards this feature adds must be reachable by
// id. A playbook that exists in the module but is not printable is a standard
// nobody can follow.
// ---------------------------------------------------------------------------
{
  const brain = makeBrain("playbook-ids", { features: [featureFor("alpha")] });
  for (const id of ["grill", "write"]) {
    const res = runIn(brain, "playbook", id);
    ok(`brain playbook ${id} prints`, res.status === 0 && (res.stdout || "").length > 500, `exit ${res.status}`);
  }
  const index = runIn(brain, "playbook");
  ok(
    "the playbook index lists grill and write",
    (index.stdout || "").includes("grill,") && (index.stdout || "").includes("write,"),
    index.stdout
  );
}

// ---------------------------------------------------------------------------
// Evaluator separation — the task verification contract (`verify`) and the
// receipt's `implemented_by` + self-verification warning, end to end.
// ---------------------------------------------------------------------------
{
  const base = { id: "t1", title: "x", status: "open", acceptance: "it works" };
  acceptsTasks("task without verify stays valid (read-compat)", { tasks: [base] });
  acceptsTasks("task with a verify contract is valid", { tasks: [{ ...base, verify: "run the suite" }] });
  rejectsTasks("blank verify is rejected", { tasks: [{ ...base, verify: "  " }] }, "tasks[0].verify");
  rejectsTasks("non-string verify is rejected", { tasks: [{ ...base, verify: 42 }] }, "tasks[0].verify");

  const brain = makeBrain("verify-contract", { features: [featureFor("alpha")] });
  const add = runIn(brain, "tasks", "add", "alpha", "--title", "T", "--acceptance", "A", "--verify", "VERIFY-METHOD");
  ok("tasks add --verify exits 0", add.status === 0, add.stderr);
  ok("...stores verify on the task", readTasks(brain, "alpha").data?.tasks?.[0]?.verify === "VERIFY-METHOD");
  const view = runIn(brain, "tasks", "view", "alpha", "t1");
  ok("tasks view shows verify", /^\s*verify: \|\n\s*VERIFY-METHOD$/m.test(view.stdout || ""), view.stdout);
  const brief = runIn(brain, "brief", "alpha", "t1");
  const bout = brief.stdout || "";
  ok("brief shows verify right after acceptance",
    /acceptance: \|\n\s*A\n\s*verify: \|\n\s*VERIFY-METHOD\n/.test(bout), bout);
  const blank = runIn(brain, "tasks", "add", "alpha", "--title", "T", "--acceptance", "A", "--verify", " ");
  ok("tasks add --verify blank is a usage error", blank.status === 2, `exit ${blank.status}`);
  const noVerify = runIn(brain, "tasks", "add", "alpha", "--title", "T2", "--acceptance", "A2");
  ok("tasks add without --verify still works", noVerify.status === 0, noVerify.stderr);
  const brief2 = runIn(brain, "brief", "alpha", "t2");
  ok("brief prints a definitive verify: none", /^\s*verify: none$/m.test(brief2.stdout || ""), brief2.stdout);

  // `brain receipt` in a real git repo: author of HEAD is the default implementer.
  const repo = path.join(tmpRoot, "ind-receipt-repo");
  fs.mkdirSync(repo, { recursive: true });
  const g = (...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  g("init", "-q");
  g("config", "user.email", "fixture@example.com");
  g("config", "user.name", "Builder Bot");
  const rb = path.join(repo, ".brain");
  fs.mkdirSync(path.join(rb, "features", "alpha", "verifications"), { recursive: true });
  fs.mkdirSync(path.join(rb, "runs"), { recursive: true });
  fs.writeFileSync(path.join(rb, "runs", "progress.md"), "# Progress\n\n---\n");
  fs.writeFileSync(
    path.join(rb, "features", "feature_list.json"),
    JSON.stringify({ features: [featureFor("alpha", { status: "shipped", evidence: "proof" })] }, null, 2) + "\n"
  );
  fs.writeFileSync(path.join(rb, "features", "alpha", "alpha.md"), "# alpha\n");
  const vdoc = path.join(rb, "features", "alpha", "verifications", "2026-07-31.md");
  fs.writeFileSync(vdoc, "# V\n\n**Verdict**: ✅ PASS\n");
  runIn(rb, "features", "index", "--write", "--create"); // so the whole check is otherwise green
  g("add", "-A");
  g("commit", "-qm", "one");

  const self = runIn(rb, "receipt", "alpha", "--verified-by", "builder bot", "--allow-dirty");
  const sout = self.stdout || "";
  ok("receipt with equal identities still stamps (exit 0)", self.status === 0, self.stderr);
  ok("...defaults implemented_by to the HEAD author", /implemented_by: Builder Bot/.test(sout), sout);
  ok("...writes implemented_by into the block", /implemented_by: Builder Bot/.test(fs.readFileSync(vdoc, "utf8")));
  ok("...prints a warning line", /^warning: "?self-verified/m.test(sout), sout);
  ok("...points at the independent verifier playbook", /brain playbook verify/.test(sout), sout);
  ok("...records verified_by_source: flag / implemented_by_source: default",
    /^verified_by_source: flag$/m.test(fs.readFileSync(vdoc, "utf8")) &&
      /^implemented_by_source: default$/m.test(fs.readFileSync(vdoc, "utf8")),
    fs.readFileSync(vdoc, "utf8"));
  ok("...prints both sources in the result",
    /^\s+verified_by_source: flag$/m.test(sout) && /^\s+implemented_by_source: default$/m.test(sout), sout);
  ok("...one flag only → warning names identities defaulted",
    /^warning: .*identities defaulted — pass --verified-by\/--implemented-by/m.test(sout), sout);
  ok("...exactly one warning key", (sout.match(/^warning:/gm) || []).length === 1, sout);
  ok("...stderr stays empty", (self.stderr || "") === "", self.stderr);
  const warnRow = brainCheck(rb, { strict: true }).find((row) => row.check === "every shipped feature was verified independently");
  ok("check --strict row warns on that receipt", warnRow?.status === "warn", warnRow?.detail);
  const chk = runIn(rb, "check", "--strict");
  ok("check --strict exit stays 0 on a warn", chk.status === 0, chk.stdout);

  const indep = runIn(rb, "receipt", "alpha", "--verified-by", "verifier-agent", "--implemented-by", "builder-agent", "--allow-dirty");
  ok("receipt with distinct identities has no self-verified warning", indep.status === 0 && !/self-verified/.test(indep.stdout || ""), indep.stdout);
  ok("...and, with both flags, no identities-defaulted warning", !/identities defaulted/.test(indep.stdout || ""), indep.stdout);
  ok("...records both sources as flag",
    /^verified_by_source: flag$/m.test(fs.readFileSync(vdoc, "utf8")) && /^implemented_by_source: flag$/m.test(fs.readFileSync(vdoc, "utf8")));
  const passRow = brainCheck(rb, { strict: true }).find((row) => row.check === "every shipped feature was verified independently");
  ok("...and the independence row passes", passRow?.status === "pass", passRow?.detail);

  // Both defaults come from git identity: a solo human stamping with NO flags
  // must trip the self-verified warning, not silently pass ($USER vs author).
  const dflt = runIn(rb, "receipt", "alpha", "--allow-dirty");
  const dout = dflt.stdout || "";
  ok("receipt with no identity flags defaults verified_by to git user.name", /verified_by: Builder Bot/.test(dout), dout);
  ok("...and warns as self-verified", /^warning: "?.*self-verified/m.test(dout), dout);
  ok("...and warns identities defaulted", /^warning: .*identities defaulted/m.test(dout), dout);
  ok("...and help says to re-stamp with --verified-by", /Identities defaulted: re-stamp with `brain receipt alpha --verified-by/.test(dout), dout);

  // The round-7 hole: defaults that DIFFER (a bot authored HEAD, user.name is
  // you) must not read as independent.
  g("config", "user.name", "Human Reviewer");
  const botDflt = runIn(rb, "receipt", "alpha", "--allow-dirty");
  const bout2 = botDflt.stdout || "";
  ok("defaults with differing names: receipt stamps (exit 0)", botDflt.status === 0, botDflt.stderr);
  ok("...no self-verified warning (names differ)", !/self-verified/.test(bout2), bout2);
  ok("...but warns identities defaulted", /^warning: .*identities defaulted/m.test(bout2), bout2);
  const botRow = brainCheck(rb, { strict: true }).find((row) => row.check === "every shipped feature was verified independently");
  ok("...and check --strict warns identities not declared, never passes", botRow?.status === "warn" && /identities not declared: alpha/.test(botRow?.detail || ""), botRow && `${botRow.status}: ${botRow.detail}`);
  const botChk = runIn(rb, "check", "--strict");
  ok("...check --strict exit stays 0", botChk.status === 0, botChk.stdout);
  const explicitV = runIn(rb, "receipt", "alpha", "--verified-by", "verifier-agent", "--allow-dirty");
  ok("explicit verifier + defaulted implementer: still warns identities defaulted", /^warning: .*identities defaulted/m.test(explicitV.stdout || ""), explicitV.stdout);
  const evRow = brainCheck(rb, { strict: true }).find((row) => row.check === "every shipped feature was verified independently");
  ok("...but the independence row passes (the verifier declared itself)", evRow?.status === "pass", evRow && `${evRow.status}: ${evRow.detail}`);
}

// ---------------------------------------------------------------------------
// Same-day fix rounds: round 1 is <date>.md, round N >= 2 is <date>-rN.md, one
// Verdict per doc. A same-day "new dated doc" used to collide with round 1's
// filename, and a `## Round N` addendum holding FAIL + PASS parsed as unknown.
// Every consumer of the filename stem must accept the -rN suffix.
// ---------------------------------------------------------------------------
{
  const brain = makeBrain("fix-rounds", {
    features: [featureFor("alpha", { status: "shipped", evidence: "round 2 PASS" })],
  });
  const vdir = path.join(brain, "features", "alpha", "verifications");
  fs.mkdirSync(vdir, { recursive: true });
  fs.writeFileSync(path.join(vdir, "2026-01-01.md"), "# V\n\n- **Round**: 1\n\n**Verdict**: \u274c FAIL\n");
  fs.writeFileSync(path.join(vdir, "2026-01-01-r2.md"), PASS_DOC.replace("# V\n\n", "# V\n\n- **Round**: 2\n\n"));
  const docs = listVerifications(brain, "alpha");
  ok("fix rounds: listVerifications orders <date>-r2 before <date>", docs.map((d) => d.date).join(",") === "2026-01-01-r2,2026-01-01", JSON.stringify(docs));
  ok("fix rounds: each round's verdict parses on its own", docs[0]?.verdict === "PASS" && docs[1]?.verdict === "FAIL", JSON.stringify(docs));
  const view = runIn(brain, "verifications", "view", "alpha", "2026-01-01-r2");
  ok("fix rounds: `verifications view <slug> <date>-r2` works", view.status === 0 && /verdict: PASS/.test(view.stdout || ""), (view.stdout || "") + (view.stderr || ""));
  const checks = brainCheck(brain, { strict: true });
  ok("fix rounds: both docs have a readable Verdict", rowStatus(checks, "verification docs have a readable Verdict") === "pass", JSON.stringify(checks));
  ok("fix rounds: strict sees the round-2 PASS", rowStatus(checks, "every shipped feature has a PASS verification") === "pass", JSON.stringify(checks));
  ok("fix rounds: strict sees the round-2 receipt", rowStatus(checks, "every PASS verification is bound to a commit") === "pass", JSON.stringify(checks));
}

fs.rmSync(tmpRoot, { recursive: true, force: true });

// ---------------------------------------------------------------------------

if (failures.length) {
  console.error(`state-invariants: ${failures.length} failure(s) of ${assertions} assertion(s)`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`state-invariants: ok — ${assertions} assertions (schema, verdict parsing, atomic write, brainCheck)`);
