// lib/state.js — the brain's STATE contract, shared by bin/brain.js and
// lib/review/brain-data.js. Owns the feature-list schema, the single verdict
// parser, and the atomic write path.
//
// Why this module exists: `brain check` used to assert only that
// feature_list.json parsed as JSON, and two different readers disagreed about
// what a verification Verdict line meant. Both invariants are needed by the CLI
// (bin/) and by the review server's persistence layer (lib/review/), so they
// cannot live in either one.
//
// Contracts, matching the rest of the repo:
//   - validators return null when valid, else ONE precise message naming the
//     exact bad field (same contract as validateVerifyShape in bin/brain.js and
//     validateSuiteShape in lib/review/evals.js)
//   - nothing here throws on bad input or calls process.exit; callers decide
//   - pure node:fs / node:path, zero dependencies
//
// NOTE: readJsonSafe is deliberately NOT hoisted here. bin/brain.js's copy
// returns {} on a missing file and opErrors on malformed JSON; brain-data.js's
// returns null for both. Those are different contracts serving different
// callers, not an accidental duplication.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// The five legal feature states. Mirrored from bin/brain.js's STATUSES — this
// module is the source of truth and bin/ imports it.
export const STATUSES = ["planned", "in-progress", "shipped", "blocked", "cut"];

// Every field a feature entry may carry, in display order.
export const FEATURE_FIELDS = [
  "id",
  "name",
  "slug",
  "status",
  "description",
  "dependencies",
  "evidence",
  "owners",
  "doc",
];

// Fields a feature entry MUST carry. `evidence` is required only for shipped
// (enforced separately) because an in-progress feature has nothing to show yet.
export const REQUIRED_FEATURE_FIELDS = ["id", "name", "slug", "status", "doc"];

export const FEATURE_LIST_SNIPPET =
  '{"updated":"YYYY-MM-DD","policy":{"one_in_progress_at_a_time":true},"features":[]}';

export function featureListPath(brain) {
  return path.join(brain, "features", "feature_list.json");
}

// ---------------------------------------------------------------------------
// Feature-list schema
// ---------------------------------------------------------------------------

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function badStringArray(v, at, field) {
  if (v === undefined) return null;
  if (!Array.isArray(v)) return `${at}.${field} must be an array`;
  const bad = v.findIndex((s) => !nonEmptyString(s));
  if (bad !== -1) return `${at}.${field}[${bad}] must be a non-empty string`;
  return null;
}

// Is the one-in-progress policy in force for this list? ONE definition, because
// the setter and the checker disagreed twice in a row: the setter tested
// `list.policy?.one_in_progress_at_a_time` (so an absent policy meant NOT
// enforced) while brainCheck hardcoded the invariant (absent policy meant
// enforced). A brain with no policy key could therefore be pushed into a state
// that `brain check` then failed.
//
// Absent policy enforces — that is the historical brainCheck behavior and the
// safer default. Only an explicit `false` opts out.
// Slugs exempt from the strict proof requirement because they shipped BEFORE the
// invariant existed. This is a ratchet, not an escape hatch: the list is
// committed and reviewable, it exempts only what is on it, and every NEW ship
// must satisfy the gate. It exists because the alternative — authoring PASS docs
// for flows nobody verified — is fabricating evidence, and the alternative to
// THAT was leaving strict as a decaying advisory nobody reads.
//
// The list should only ever shrink. `brain check --strict` says so when an entry
// becomes provable.
export function strictGrandfathered(list) {
  const raw = list && list.policy && list.policy.strict_grandfathered;
  return new Set(Array.isArray(raw) ? raw : []);
}

export function oneInProgressEnforced(list) {
  return !(list && list.policy && list.policy.one_in_progress_at_a_time === false);
}

// Structure-only validation: the two shapes that make every caller's
// `list.features.find(...)` throw. Kept separate from the full field validation
// below so a brain with ONE bad record is still repairable through the CLI —
// hard-failing every read on any field problem meant a legacy
// shipped-without-evidence entry could not even be set back to `planned`
// without hand-editing JSON, which is precisely the situation the CLI exists to
// avoid. Fatal problems still hard-fail; field problems are `brain check`'s job.
export function validateFeatureListStructure(parsed) {
  if (!isPlainObject(parsed)) return "feature_list.json must be a JSON object";
  if (!Array.isArray(parsed.features)) return `"features" must be an array`;
  const bad = parsed.features.findIndex((f) => !isPlainObject(f));
  if (bad !== -1) return `features[${bad}] must be an object`;
  return null;
}

// Validates the parsed feature_list.json shape. Returns null when valid, else a
// precise message naming the exact bad field.
//
// This is the check that used to be missing entirely: previously `{}`, `[]`,
// `"hello"`, `42`, and {"features": "nope"} all passed as "feature_list.json
// parses", and a non-array `features` was silently coerced to [].
export function validateFeatureListShape(parsed) {
  if (!isPlainObject(parsed)) return "feature_list.json must be a JSON object";
  if (!Array.isArray(parsed.features)) return `"features" must be an array`;

  if (parsed.policy !== undefined) {
    if (!isPlainObject(parsed.policy)) return `"policy" must be an object`;
    const flag = parsed.policy.one_in_progress_at_a_time;
    if (flag !== undefined && typeof flag !== "boolean")
      return `policy.one_in_progress_at_a_time must be a boolean`;
    const gf = parsed.policy.strict_grandfathered;
    if (gf !== undefined) {
      const err = badStringArray(gf, "policy", "strict_grandfathered");
      if (err) return err;
    }
  }

  const ids = new Map();
  const slugs = new Map();

  for (let i = 0; i < parsed.features.length; i++) {
    const f = parsed.features[i];
    const at = `features[${i}]`;
    if (!isPlainObject(f)) return `${at} must be an object`;

    for (const field of REQUIRED_FEATURE_FIELDS) {
      if (!nonEmptyString(f[field]))
        return `${at}.${field} must be a non-empty string`;
    }

    if (!STATUSES.includes(f.status))
      return `${at}.status "${f.status}" is not one of ${STATUSES.join("|")}`;

    // A shipped feature with no evidence is the exact shape of a premature
    // "done" — the failure mode the whole harness exists to prevent.
    if (f.status === "shipped" && !nonEmptyString(f.evidence))
      return `${at}.evidence is required when status is "shipped" (${f.slug})`;

    if (ids.has(f.id))
      return `${at}.id "${f.id}" is not unique (also features[${ids.get(f.id)}])`;
    ids.set(f.id, i);

    if (slugs.has(f.slug))
      return `${at}.slug "${f.slug}" is not unique (also features[${slugs.get(f.slug)}])`;
    slugs.set(f.slug, i);

    const depErr = badStringArray(f.dependencies, at, "dependencies");
    if (depErr) return depErr;
    const ownErr = badStringArray(f.owners, at, "owners");
    if (ownErr) return ownErr;

    if (f.description !== undefined && typeof f.description !== "string")
      return `${at}.description must be a string`;
    if (f.evidence !== undefined && typeof f.evidence !== "string")
      return `${at}.evidence must be a string`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Task schema — features/<slug>/tasks.json, the coordination layer BELOW a
// feature. Same validator contract as validateFeatureListShape: null when
// valid, else ONE precise message naming the exact bad field with its index.
// ---------------------------------------------------------------------------

// The five legal task states. `open` plays the role `planned` plays for a
// feature (not yet claimed); `claimed` is `in-progress` held by exactly one
// owner, so two workers can hold two different tasks at once even though
// `policy.one_in_progress_at_a_time` still allows only one feature.
export const TASK_STATUSES = ["open", "claimed", "done", "blocked", "cut"];

// Every field a task entry may carry, in display order.
export const TASK_FIELDS = [
  "id",
  "title",
  "status",
  "acceptance",
  "depends_on",
  "files",
  "owner",
  "claimed_at",
  "evidence",
  "receipt",
];

// Fields a task MUST carry from the moment it exists, regardless of status.
// `acceptance` is required up front, not just at close, because a task with no
// checkable definition of done is the same "premature done" shape the
// feature-level evidence rule exists to prevent — one level further down.
export const REQUIRED_TASK_FIELDS = ["id", "title", "status", "acceptance"];

export function tasksPath(brain, slug) {
  return path.join(brain, "features", slug, "tasks.json");
}

// Same "what does a commit look like" standard parseReceipt already enforces
// below for a verification receipt. A second regex here would be a second
// definition of the same invariant — precisely the class of bug this module
// exists to stop (two verdict parsers once disagreed about one file).
// ONE definition of what a bindable commit id looks like. Symbolic refs (HEAD,
// a branch, a tag, HEAD~2) resolve fine through cat-file/merge-base but move,
// so they bind a verdict to nothing. Used by both parseReceipt (verification
// receipts) and validateTasksShape (task receipts) — writing the pattern twice
// is how the two would drift into disagreeing about the same question.
const RECEIPT_COMMIT_RE = /^[0-9a-f]{7,40}$/i;

// Iterative DFS with an explicit stack, not recursion — a dependency chain
// nobody thought to bound should not be able to blow the call stack the way a
// recursive walk would. Returns the cycle as an array of ids with the
// repeated id at the end (e.g. ["t1","t2","t1"]), or null when acyclic. A
// dependency naming an id outside this file is not this function's problem —
// validateTasksShape rejects that shape before this ever runs — so here such
// an id is simply a leaf with no further edges.
function findDependsOnCycle(tasks) {
  const state = new Map(); // absent = unvisited, "active" = on the current path, "done" = fully explored
  const depsOf = new Map(
    tasks.map((t) => [t.id, Array.isArray(t.depends_on) ? t.depends_on : []])
  );

  for (const start of depsOf.keys()) {
    if (state.get(start) === "done") continue;
    const walk = [start];
    const stack = [{ id: start, i: 0 }];
    state.set(start, "active");

    while (stack.length) {
      const frame = stack[stack.length - 1];
      const deps = depsOf.get(frame.id) || [];
      if (frame.i < deps.length) {
        const next = deps[frame.i++];
        if (state.get(next) === "active") {
          const idx = walk.indexOf(next);
          return walk.slice(idx).concat(next);
        }
        if (state.get(next) !== "done" && depsOf.has(next)) {
          state.set(next, "active");
          walk.push(next);
          stack.push({ id: next, i: 0 });
        }
      } else {
        state.set(frame.id, "done");
        walk.pop();
        stack.pop();
      }
    }
  }
  return null;
}

// Validates the parsed tasks.json shape. Returns null when valid, else a
// precise message naming the exact bad field — including the same
// "do not silently coerce" rule validateFeatureListShape follows:
// `(data && data.tasks) || []` is exactly the bug that let `{}` pass every
// feature-list check, and would do the same here if repeated.
export function validateTasksShape(data, slug) {
  if (!isPlainObject(data)) return "tasks.json must be a JSON object";
  if (!Array.isArray(data.tasks)) return `"tasks" must be an array`;

  // A tasks.json copied from another feature and never re-pointed is a silent
  // misattribution nothing below would otherwise catch — the file would
  // validate perfectly while coordinating the wrong feature's work.
  if (data.feature !== undefined) {
    if (!nonEmptyString(data.feature)) return `"feature" must be a non-empty string`;
    if (slug !== undefined && data.feature !== slug)
      return `"feature" is "${data.feature}", not "${slug}"`;
  }

  const ids = new Map();

  for (let i = 0; i < data.tasks.length; i++) {
    const t = data.tasks[i];
    const at = `tasks[${i}]`;
    if (!isPlainObject(t)) return `${at} must be an object`;

    for (const field of REQUIRED_TASK_FIELDS) {
      if (!nonEmptyString(t[field])) return `${at}.${field} must be a non-empty string`;
    }

    if (!TASK_STATUSES.includes(t.status))
      return `${at}.status is not one of ${TASK_STATUSES.join("|")}`;

    if (ids.has(t.id))
      return `${at}.id "${t.id}" is not unique (also tasks[${ids.get(t.id)}])`;
    ids.set(t.id, i);

    const depErr = badStringArray(t.depends_on, at, "depends_on");
    if (depErr) return depErr;
    const filesErr = badStringArray(t.files, at, "files");
    if (filesErr) return filesErr;

    if (t.owner !== undefined && !nonEmptyString(t.owner))
      return `${at}.owner must be a non-empty string`;
    if (t.claimed_at !== undefined && !nonEmptyString(t.claimed_at))
      return `${at}.claimed_at must be a non-empty string`;
    if (t.evidence !== undefined && typeof t.evidence !== "string")
      return `${at}.evidence must be a string`;

    // A task marked done with nothing said about it is the exact "premature
    // done" shape the feature-level evidence rule exists to prevent, one
    // level further down.
    if (t.status === "done" && !nonEmptyString(t.evidence))
      return `${at}.evidence is required when status is "done"`;

    // A claim with no owner or no timestamp is unrecoverable: nobody reading
    // the file can tell who holds it or how long it has been held, so
    // `brain tasks release` would have nothing to show and nothing to release.
    if (t.status === "claimed" && !nonEmptyString(t.owner))
      return `${at}.owner is required when status is "claimed"`;
    if (t.status === "claimed" && !nonEmptyString(t.claimed_at))
      return `${at}.claimed_at is required when status is "claimed"`;

    if (t.receipt !== undefined) {
      if (!isPlainObject(t.receipt)) return `${at}.receipt must be an object`;
      if (t.receipt.commit !== undefined) {
        if (!nonEmptyString(t.receipt.commit) || !RECEIPT_COMMIT_RE.test(t.receipt.commit))
          return `${at}.receipt.commit "${t.receipt.commit}" is not a hex object id`;
      }
    }
  }

  // Dependency TARGETS are only checked once every id in the file is known, so
  // a task may depend on one declared later in the array — authoring order is
  // not required to be topological order.
  for (let i = 0; i < data.tasks.length; i++) {
    const deps = data.tasks[i].depends_on;
    if (!Array.isArray(deps)) continue;
    for (let j = 0; j < deps.length; j++) {
      if (!ids.has(deps[j]))
        return `tasks[${i}].depends_on[${j}] "${deps[j]}" does not name a task in this file`;
    }
  }

  const cycle = findDependsOnCycle(data.tasks);
  if (cycle) return `tasks depends_on cycle: ${cycle.join(" -> ")}`;

  return null;
}

// Tasks a coordinator can actually hand out right now: open, and every
// dependency already done. A cyclic file returns [] rather than a partial
// guess — asserting what is "next" in a graph that cannot be topologically
// ordered would be a wrong answer dressed as a real one.
export function unblockedTasks(data) {
  if (!data || !Array.isArray(data.tasks)) return [];
  if (findDependsOnCycle(data.tasks)) return [];
  const statusById = new Map(data.tasks.map((t) => [t.id, t.status]));
  return data.tasks.filter(
    (t) =>
      t.status === "open" &&
      (Array.isArray(t.depends_on) ? t.depends_on : []).every((d) => statusById.get(d) === "done")
  );
}

// ---------------------------------------------------------------------------
// Verdict parsing — ONE parser, two accepted forms
// ---------------------------------------------------------------------------

// Line-anchored, and every form of code block is stripped first: an unanchored
// substring search matched `**Verdict**:` inside a quoted example, so a doc
// could show what a verdict looks like and be scored on the sample.
//
// Leading whitespace is capped at 3 spaces on purpose. Markdown treats 4+ spaces
// as an indented code block, so allowing `[ \t]*` here meant an indented example
// — a code block by every renderer's rules — still scored as the real verdict.
const VERDICT_LINE_ALL = /^ {0,3}(?:[-*][ \t]*)?\*\*Verdict\*\*:[ \t]*(.+)$/gm;
// CommonMark closes a fence with a run of the SAME character at least as long as
// the opener — NOT exactly as long. A `\1` backreference required exact length,
// so a 3-backtick open closed by 4 backticks left the block unstripped and a
// later verdict inside it scored as real.
const FENCED_BLOCK = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1`*~*[ \t]*$/gm;
// An UNCLOSED fence swallows the rest of the document in every renderer, so it
// must here too — otherwise `` ``` `` followed by a verdict was scored as real.
const UNCLOSED_FENCE = /^[ \t]*(`{3,}|~{3,})[\s\S]*$/m;
// HTML comments render as NOTHING, so a verdict inside one is invisible to the
// human reading the doc while parsing as real.
//
// The receipt block is itself an HTML comment, which made the first attempt at
// this self-defeating: a negative lookahead for `brain:verification` scanned the
// REST OF THE DOCUMENT, so any doc containing a receipt kept every earlier
// comment unstripped — the spoof then worked precisely on the docs that satisfy
// the strict gate. And a verdict line inside the receipt body scored too.
//
// Correct order: remove receipt blocks FIRST (they are matched by their own
// pattern), then strip every remaining comment, then look for a verdict. A
// verdict is never read out of a receipt body.
const RECEIPT_BLOCK_G = /<!--\s*brain:verification[\s\S]*?-->/g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
// An UNCLOSED comment hides the rest of the document in every renderer — same
// class as UNCLOSED_FENCE below, and missed for the same reason: the closed case
// was fixed and the unclosed one was not considered.
const UNCLOSED_COMMENT = /<!--[\s\S]*$/;
// "Bogus comments" in the HTML spec: `<?...>`, `<!DOCTYPE...>`, `<![CDATA[...]]>`.
// Every renderer swallows these, but they match neither the tag pattern nor the
// `<!--` comment pattern — so a verdict inside one was invisible to a reader and
// still scored. Same class as the unclosed comment, one syntax further out.
const BOGUS_COMMENT = /<[?!](?!--)[\s\S]*?(?:>|$)/g;

const VERDICT_EMOJI = { "✅": "PASS", "❌": "FAIL", "⛔": "BLOCKED" };

// The token must LEAD the verdict value (after an optional emoji), not merely
// appear somewhere in it. A trailing-substring match scored
// "**Verdict**: this is not PASS" as PASS — the exact inversion of its meaning.
const VERDICT_LEAD = /^(?:(✅|❌|⛔)[ \t]*)?(PASS|FAIL|BLOCKED)\b/i;
const VERDICT_EMOJI_ONLY = /^(✅|❌|⛔)[ \t]*$/;

// Full result: { verdict, hasLine, form } where form is "emoji" | "word" |
// "none". Callers that need to tell "no Verdict line at all" from "a Verdict
// line nobody can read" use this; parseVerdict() below is the string-only form
// the existing read surfaces already expect.
//
// Both forms are accepted because both exist in the wild: the authoring
// playbook asks for `**Verdict**: ✅ PASS`, but real docs also write
// `**Verdict**: PASS (live smoke against the dev server)`. The old parser
// decided purely by emoji substring, so that second form silently read as
// "unknown" on every display surface while `brain check` — which only tested
// for the presence of `**Verdict**:` — passed it.
export function parseVerdictDetail(content) {
  // Strip closed fences, then anything after an unclosed one, so no documented
  // example can score as the verdict.
  const prose = String(content || "")
    .replace(RECEIPT_BLOCK_G, "") // receipts out first — never scanned for verdicts
    .replace(HTML_COMMENT, "") // then every other comment (invisible to a reader)
    .replace(UNCLOSED_COMMENT, "") // and an unclosed one hides everything after it
    .replace(BOGUS_COMMENT, "") // `<?`, `<!DOCTYPE`, `<![CDATA[` — swallowed by every renderer
    .replace(FENCED_BLOCK, "")
    .replace(UNCLOSED_FENCE, "");
  const values = [];
  VERDICT_LINE_ALL.lastIndex = 0;
  for (const m of prose.matchAll(VERDICT_LINE_ALL)) values.push(m[1].trim());

  if (values.length === 0) return { verdict: "unknown", hasLine: false, form: "none" };

  const read = values.map(readVerdictValue);

  if (read.length > 1) {
    // Disagreement is ambiguous — silently taking the first let an amended doc
    // keep a stale PASS above a later FAIL. But a doc that simply RESTATES the
    // same verdict in a summary is not ambiguous, and failing it punished good
    // writing.
    const distinct = new Set(read.map((r) => r.verdict));
    if (distinct.size > 1 || read.some((r) => r.verdict === "unknown"))
      return { verdict: "unknown", hasLine: true, form: "ambiguous", count: read.length };
    return { verdict: read[0].verdict, hasLine: true, form: read[0].form, count: read.length };
  }

  return { ...read[0], hasLine: true };
}

function readVerdictValue(value) {
  const lead = value.match(VERDICT_LEAD);
  if (lead) {
    const emoji = lead[1];
    const word = lead[2].toUpperCase();
    // An emoji contradicting its word is ambiguous, not a tie to break — and
    // that holds wherever the emoji sits. A TRAILING one used to be ignored, so
    // `**Verdict**: ✅ PASS ❌` read as a clean PASS.
    const emojisPresent = Object.keys(VERDICT_EMOJI).filter((e) => value.includes(e));
    if (emojisPresent.some((e) => VERDICT_EMOJI[e] !== word))
      return { verdict: "unknown", form: "conflicting" };
    return { verdict: word, form: emoji ? "emoji" : "word" };
  }
  const emojiOnly = value.match(VERDICT_EMOJI_ONLY);
  if (emojiOnly) return { verdict: VERDICT_EMOJI[emojiOnly[1]], form: "emoji" };
  return { verdict: "unknown", form: "none" };
}

export function parseVerdict(content) {
  return parseVerdictDetail(content).verdict;
}

export const VERDICT_ACCEPTED =
  "**Verdict**: ✅ PASS | ❌ FAIL | ⛔ BLOCKED (the bare word PASS/FAIL/BLOCKED is also accepted)";

// ---------------------------------------------------------------------------
// Verification receipts — binding a verdict to the code it was taken against
// ---------------------------------------------------------------------------

// A verdict with no commit is unfalsifiable: the doc is a mutable, date-named
// markdown file, so "it passed" could refer to any tree that ever existed. The
// receipt block makes the claim checkable — you can ask whether the commit is
// still an ancestor of HEAD, and whether the feature's files moved since.
//
// Deliberately an HTML comment: it renders as nothing, so the doc stays readable
// prose for a human while carrying machine-checkable provenance.
const RECEIPT_BLOCK = /<!--\s*brain:verification\s*([\s\S]*?)-->/;

export const RECEIPT_SNIPPET = [
  "<!-- brain:verification",
  "commit: <short sha, e.g. from `git rev-parse --short HEAD`>",
  "verified_by: feature-verifier",
  'commands: bun run test (exit 0); bun run typecheck (exit 0)',
  "-->",
].join("\n");

// Returns { present, commit, verified_by, commands, raw } — never throws. Absent
// is `{present:false}`, NOT an error: read-compat means docs written before the
// block existed still parse (they report `legacy` at the check layer).
export function parseReceipt(content) {
  const m = String(content || "").match(RECEIPT_BLOCK);
  if (!m) return { present: false };
  const fields = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^\s*([a-z_]+)\s*:\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  const rawCommit = fields.commit || null;
  // Symbolic refs (HEAD, a branch, a tag, HEAD~2) resolve fine through
  // cat-file/merge-base but move, so they bind the verdict to nothing.
  const commit = rawCommit && RECEIPT_COMMIT_RE.test(rawCommit) ? rawCommit : null;
  return {
    present: true,
    commit,
    commit_raw: rawCommit,
    commit_symbolic: Boolean(rawCommit) && !commit,
    verified_by: fields.verified_by || null,
    commands: fields.commands || null,
    raw: m[1],
  };
}

// ---------------------------------------------------------------------------
// Git provenance — every helper degrades to "unknown" outside a repo
// ---------------------------------------------------------------------------

function git(repoRoot, args) {
  const res = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  return { ok: res.status === 0, out: (res.stdout || "").trim() };
}

// A harness in a non-git directory still records state, just without provenance —
// so callers must treat "" / null as "unknown", never as "invalid".
export function gitShortHead(repoRoot) {
  const r = git(repoRoot, ["rev-parse", "--short", "HEAD"]);
  return r.ok ? r.out : "";
}

export function gitCommitExists(repoRoot, sha) {
  if (!sha) return false;
  return git(repoRoot, ["cat-file", "-e", `${sha}^{commit}`]).ok;
}

// Is `sha` reachable from HEAD? A receipt whose commit is NOT an ancestor was
// taken on a branch that never landed — the verdict describes code that is not
// what shipped.
export function gitIsAncestor(repoRoot, sha) {
  if (!sha) return false;
  return git(repoRoot, ["merge-base", "--is-ancestor", sha, "HEAD"]).ok;
}

// Does the working tree differ from HEAD? A receipt naming HEAD while the tree
// has uncommitted changes describes code that exists in no commit.
export function gitWorktreeDirty(repoRoot) {
  const r = git(repoRoot, ["status", "--porcelain"]);
  return r.ok ? r.out.length > 0 : false;
}

export function isGitRepo(repoRoot) {
  return git(repoRoot, ["rev-parse", "--git-dir"]).ok;
}

// ---------------------------------------------------------------------------
// Atomic writes
// ---------------------------------------------------------------------------

// Write via a sibling temp file + rename so a crash or a concurrent reader can
// never observe a truncated file. Every writer of durable brain state should go
// through this: lib/review/server.js:413 already noted that other tools save
// atomically and brain-axi did not.
export function writeFileAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  // Random suffix, not the pid: two concurrent processes can share a pid across
  // containers, and a stale predictable temp path is a collision waiting to happen.
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.tmp-${crypto.randomBytes(6).toString("hex")}`
  );
  // Preserve the target's mode when it already exists — a plain writeFileSync on
  // the temp file would silently reset permissions to the default on every save.
  let mode;
  try {
    mode = fs.statSync(filePath).mode & 0o777;
  } catch {
    mode = undefined;
  }
  let fd;
  try {
    fd = fs.openSync(tmp, "w", mode === undefined ? 0o666 : mode);
    fs.writeFileSync(fd, data);
    // fsync before rename: rename is atomic w.r.t. other readers, but without
    // this the new contents can still be lost to a power failure while the
    // directory entry survives — i.e. an empty file where state used to be.
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (mode !== undefined) fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, filePath);
    // fsync the directory so the rename itself is durable.
    let dirFd;
    try {
      dirFd = fs.openSync(dir, "r");
      fs.fsyncSync(dirFd);
    } catch {
      // Not fsyncable on every platform (notably some Windows paths) — the
      // rename already happened, so this is durability polish, not correctness.
    } finally {
      if (dirFd !== undefined) fs.closeSync(dirFd);
    }
  } catch (e) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // already closed or never opened
      }
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      // best effort — the rename never happened, so the target is untouched
    }
    throw e;
  }
}

// The single writer for feature_list.json. Both mutating call sites
// (features set-status, ship) previously inlined a byte-identical
// non-atomic writeFileSync.
export function saveFeatureList(brain, list, { today } = {}) {
  const stamped = { ...list, updated: today || new Date().toISOString().slice(0, 10) };
  // Preserve key order: `updated` already exists in every real file, so the
  // spread above replaces it in place rather than moving it to the end.
  writeFileAtomic(featureListPath(brain), JSON.stringify(stamped, null, 2) + "\n");
  return stamped;
}

// ---------------------------------------------------------------------------
// tasks.json — compare-and-swap so two workers claiming at once cannot lose a
// write. Atomic (writeFileAtomic) is not the same guarantee as safe-under-
// concurrency: rename(2) stops a reader from ever seeing a torn file, but two
// processes can each read-modify-rename in turn and the second rename still
// silently discards the first one's write. CAS is the difference.
// ---------------------------------------------------------------------------

// Returns { data, hash }, where hash is the sha256 of the EXACT bytes read —
// not a hash of the parsed-and-reserialized object, because a caller compares
// this hash against what is on disk later, and re-serializing can change
// whitespace a byte-for-byte comparison would then wrongly call a change.
//
// A missing file is not an error: read-compat means a brain with no
// tasks.json for a feature still passes every check, so {data: null, hash:
// null} is the legal, expected shape for "no tasks yet" — not a failure a
// caller needs to branch away from.
export function readTasks(brain, slug) {
  const filePath = tasksPath(brain, slug);
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch {
    return { data: null, hash: null };
  }
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  let data = null;
  try {
    data = JSON.parse(bytes.toString("utf8"));
  } catch {
    // Malformed JSON is a shape problem for validateTasksShape to report, not
    // something readTasks throws on — but the hash still reflects the exact
    // bytes on disk, so a CAS write guarded by it stays race-safe regardless.
    data = null;
  }
  return { data, hash };
}

// Writes `data` to features/<slug>/tasks.json only if the file's current
// bytes still hash to `expectedHash` — i.e. nothing wrote to it since the
// caller's readTasks(). Refuses without writing on a mismatch and reports why,
// rather than throwing: this module reports, callers decide (bin/ turns a
// refusal into an opError telling the loser to re-list and retry).
//
// expectedHash === null means "I believe no file exists yet"; if one has since
// appeared, its hash is non-null and therefore never equals null, so the
// brand-new-file race is rejected by the same comparison with no special case.
// A hash comparison FOLLOWED BY a write is not a compare-and-swap. Between the
// two, another process lands its own write and both callers believe they won.
// Measured, not theorised: two concurrent `brain tasks claim` runs each reported
// success in 5/5 trials and one claim was silently discarded — precisely the
// failure the CAS decision existed to prevent. So the compare and the write
// happen inside an exclusive lock, and the compare INSIDE the lock is the
// authoritative one.
//
// This is NOT the lockfile option the plan weighed and rejected. That one held a
// lock for the DURATION OF A TASK, where a worker dying wedges the feature until
// a human deletes something. This lock spans a few filesystem calls in one
// process and is released in a `finally` — different lifetime, different risk.
//
// `wx` is O_CREAT|O_EXCL: the create either wins or fails EEXIST, atomically, on
// every POSIX filesystem. No dependency, no daemon.
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;

// Node has no sync sleep. Atomics.wait on a never-signalled buffer is the
// standard one, and is permitted on Node's main thread (unlike in browsers).
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withTasksLock(filePath, fn) {
  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(lockPath, "wx");
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      // A holder SIGKILLed mid-section would otherwise wedge every later writer.
      // The section is milliseconds, so a lock older than LOCK_STALE_MS cannot
      // belong to a live holder — steal it rather than deadlock forever.
      let age = null;
      try {
        age = Date.now() - fs.statSync(lockPath).mtimeMs;
      } catch {
        age = null; // vanished between the EEXIST and the stat — just retry
      }
      if (age !== null && age > LOCK_STALE_MS) {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // someone else stole it first; retry either way
        }
        continue;
      }
      if (Date.now() >= deadline) {
        return {
          ok: false,
          reason: "locked",
          message:
            `tasks.json for this feature is locked by another process ` +
            `(waited ${LOCK_WAIT_MS}ms) — re-read and retry`,
        };
      }
      sleepSync(15);
    }
  }
  try {
    try {
      fs.writeSync(fd, String(process.pid));
    } catch {
      // The pid is a debugging courtesy, not part of the protocol.
    }
    return fn();
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // already closed
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // a stale-breaker may have removed it; the section is over either way
    }
  }
}

export function writeTasksCas(brain, slug, data, expectedHash) {
  const filePath = tasksPath(brain, slug);
  // The lock lives beside the file, so the directory has to exist before we can
  // take it. writeFileAtomic would have created it, but that is too late.
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return withTasksLock(filePath, () => writeTasksLocked(filePath, slug, data, expectedHash));
}

function writeTasksLocked(filePath, slug, data, expectedHash) {
  let currentBytes;
  try {
    currentBytes = fs.readFileSync(filePath);
  } catch {
    currentBytes = null;
  }
  const currentHash = currentBytes
    ? crypto.createHash("sha256").update(currentBytes).digest("hex")
    : null;

  if (currentHash !== (expectedHash === undefined ? null : expectedHash)) {
    return {
      ok: false,
      reason: "stale",
      message:
        `tasks.json for "${slug}" changed since it was read ` +
        `(expected ${expectedHash || "no file"}, found ${currentHash || "no file"}) — re-read and retry`,
      expectedHash: expectedHash === undefined ? null : expectedHash,
      currentHash,
    };
  }

  const bytes = JSON.stringify(data, null, 2) + "\n";
  writeFileAtomic(filePath, bytes);
  return { ok: true, hash: crypto.createHash("sha256").update(bytes).digest("hex") };
}

// ---------------------------------------------------------------------------
// Verification docs are machine-checked artifacts, so raw HTML is banned in them
// ---------------------------------------------------------------------------

// Chasing HTML constructs one at a time is unwinnable: a verdict inside
// `<details>` renders collapsed, inside `<div>` renders as literal asterisks, and
// there is always another tag. Regex stripping cannot see HTML blocks the way a
// renderer does, so the parser and the reader will always be able to disagree.
//
// The structural answer is to remove the ambiguity instead of parsing it: a
// verification doc is evidence read by a machine AND a human, so it may not
// contain raw HTML at all — except the `brain:verification` receipt, which is an
// HTML comment on purpose (it must render as nothing).
//
// Returns a list of offending snippets; empty means clean.
const HTML_TAG = /<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi;

export function findRawHtml(content) {
  const withoutReceipts = String(content || "").replace(RECEIPT_BLOCK_G, "");
  // Fenced code may legitimately show markup as an example.
  const withoutCode = withoutReceipts
    .replace(FENCED_BLOCK, "")
    .replace(/`[^`\n]*`/g, "");
  const found = [];
  HTML_TAG.lastIndex = 0;
  for (const m of withoutCode.matchAll(HTML_TAG)) {
    found.push(m[0].slice(0, 40));
    if (found.length >= 5) break;
  }
  // A non-receipt HTML COMMENT is the other half of the same problem.
  const strayComment = withoutCode.match(/<!--[\s\S]{0,40}/);
  if (strayComment) found.push(strayComment[0].replace(/\n/g, " ").slice(0, 40));
  // And the bogus-comment forms, which hide content just as effectively.
  const bogus = withoutCode.match(/<[?!](?!--)[\s\S]{0,40}/);
  if (bogus) found.push(bogus[0].replace(/\n/g, " ").slice(0, 40));
  return found;
}
