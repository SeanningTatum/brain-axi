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
// human reading the doc while parsing as real. The receipt block is itself an
// HTML comment, so it is preserved: only comments that are not receipts go.
const HTML_COMMENT = /<!--(?![\s\S]*?brain:verification)[\s\S]*?-->/g;

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
    .replace(HTML_COMMENT, "")
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
  return {
    present: true,
    commit: fields.commit || null,
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
