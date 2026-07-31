// lib/review/brain-data.js — brain-side persistence for `brain review`.
// Reads/writes plans, review rounds, screenshots, verifications, and the
// merged timeline inside a target `.brain/` directory. Pure node:fs/path,
// synchronous, and never throws on a missing brain section — callers (CLI +
// server.js) get empty arrays/nulls instead so they can render "definitive
// empty state" output rather than crash.
//
// Layout (see docs/REVIEW-ARCHITECTURE.md, "Addendum v4 — feature-centric
// .brain layout"): every reader here is READ-COMPAT across two layouts and
// WRITE-NEW (writers target the per-feature layout whenever a feature slug
// is known, else the legacy flat fallback):
//
//   .brain/features/<slug>/
//     <slug>.md                    feature doc
//     screenshots/NN-<step>.png    golden path (01-, 02-, ...) / error (E1-, ...)
//     verifications/<date>.md      browser-walk verdict docs
//     runs/<date>-<task>.md        per-feature run notes
//     plans/<plan-slug>/           review plans scoped to this feature
//   .brain/plans/<plan-slug>/      legacy fallback pool: plans with no feature
//   .brain/screenshots/<scope>/    legacy fallback screenshots
//   .brain/runs/*.md               legacy global run notes (+ progress.md, global)
//
// See docs/REVIEW-ARCHITECTURE.md ("Brain persistence (brain-data.js)") for
// the binding shape of every export here.

import fs from "node:fs";
import path from "node:path";
import {
  validateFeatureListShape,
  parseVerdict,
  parseVerdictDetail,
  oneInProgressEnforced,
  strictGrandfathered,
  writeFileAtomic,
  parseReceipt,
  isGitRepo,
  gitCommitExists,
  gitIsAncestor,
  STATUSES,
  VERDICT_ACCEPTED,
  RECEIPT_SNIPPET,
} from "../state.js";

const SHOT_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function legacyPlansDir(brain) {
  return path.join(brain, "plans");
}

function legacyScreenshotsDir(brain) {
  return path.join(brain, "screenshots");
}

function legacyRunsDir(brain) {
  return path.join(brain, "runs");
}

function featuresRootDir(brain) {
  return path.join(brain, "features");
}

// Root directory for one feature's per-feature tree.
export function featureDir(brain, slug) {
  return path.join(featuresRootDir(brain), slug);
}

function featurePlansDir(brain, slug) {
  return path.join(featureDir(brain, slug), "plans");
}

function featureScreenshotsDir(brain, slug) {
  return path.join(featureDir(brain, slug), "screenshots");
}

function featureVerificationsDir(brain, slug) {
  return path.join(featureDir(brain, slug), "verifications");
}

function featureRunsDir(brain, slug) {
  return path.join(featureDir(brain, slug), "runs");
}

function listFeatureSlugs(brain) {
  const dir = featuresRootDir(brain);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function readJsonSafe(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Plan roots — merged list of every directory that itself contains
// <plan-slug>/ subdirectories: the legacy flat pool plus one per feature that
// has a plans/ dir. { root, feature } — feature is null for the legacy pool.
// ---------------------------------------------------------------------------

export function planRoots(brain) {
  const roots = [{ root: legacyPlansDir(brain), feature: null }];
  for (const slug of listFeatureSlugs(brain)) {
    const pd = featurePlansDir(brain, slug);
    if (fs.existsSync(pd)) roots.push({ root: pd, feature: slug });
  }
  return roots;
}

// ---------------------------------------------------------------------------
// Plan slug + title
// ---------------------------------------------------------------------------

// "YYYY-MM-DD-<basename-kebab>" using today's date; strips a .html extension.
export function slugForFile(file) {
  const base = path.basename(file).replace(/\.html?$/i, "");
  const kebab = base
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  return kebab ? `${date}-${kebab}` : date;
}

// First <title> text, else first <h1> text, else null.
function titleFromArtifact(file) {
  try {
    const html = fs.readFileSync(file, "utf8");
    const t = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (t && t[1].trim()) return t[1].trim();
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) {
      const text = h1[1].replace(/<[^>]+>/g, "").trim();
      if (text) return text;
    }
  } catch {
    // artifact unreadable — fall through to slug fallback
  }
  return null;
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

function metaPathIn(dir) {
  return path.join(dir, "meta.json");
}

function reviewsPathIn(dir) {
  return path.join(dir, "reviews.jsonl");
}

// Find an existing plan's directory by slug, searching per-feature roots
// (each feature checked in name order) before the legacy pool. On a slug
// collision across roots, the first per-feature match wins — warn-free, this
// is an accepted ambiguity (see docs/REVIEW-ARCHITECTURE.md Addendum v4 #1).
function findPlanLocation(brain, slug) {
  for (const slugName of listFeatureSlugs(brain)) {
    const dir = path.join(featurePlansDir(brain, slugName), slug);
    if (fs.existsSync(metaPathIn(dir))) return { dir, feature: slugName };
  }
  const legacyDir = path.join(legacyPlansDir(brain), slug);
  if (fs.existsSync(metaPathIn(legacyDir))) return { dir: legacyDir, feature: null };
  return null;
}

function planDirFor(brain, slug, feature) {
  return feature ? path.join(featurePlansDir(brain, feature), slug) : path.join(legacyPlansDir(brain), slug);
}

// Create meta.json if missing; returns the (existing or freshly created)
// meta. When `feature` is given and no plan by this slug exists anywhere
// yet, the plan is rooted under that feature's plans/ dir; otherwise (no
// feature, or an existing plan found elsewhere) the existing location wins.
export function ensurePlan(brain, slug, file, { feature } = {}) {
  const found = findPlanLocation(brain, slug);
  if (found) {
    const meta = readJsonSafe(metaPathIn(found.dir));
    if (meta) return meta;
  }

  const dir = planDirFor(brain, slug, feature || null);
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const meta = {
    slug,
    title: titleFromArtifact(file) || slug,
    file: path.resolve(file),
    feature: feature || null,
    status: "draft",
    created: now,
    updated: now,
    rounds: 0,
  };
  writeFileAtomic(metaPathIn(dir), JSON.stringify(meta, null, 2) + "\n");
  return meta;
}

// [{slug, title, status, created, updated, rounds, feature}] newest first
// (by updated), merged across the legacy pool and every feature's plans/.
// Collisions: resolved in findPlanLocation's exact order (features in name
// order, then legacy; first match wins) so the plan listed here is always
// the same plan ensurePlan/recordReviewRound write to.
export function listPlans(brain) {
  const bySlug = new Map();
  const roots = planRoots(brain);
  const ordered = [...roots.filter((r) => r.feature), ...roots.filter((r) => !r.feature)];
  for (const { root, feature } of ordered) {
    if (!fs.existsSync(root)) continue;
    for (const slug of fs.readdirSync(root)) {
      if (bySlug.has(slug)) continue;
      const meta = readJsonSafe(metaPathIn(path.join(root, slug)));
      if (!meta) continue;
      bySlug.set(slug, { meta, feature });
    }
  }
  const out = [...bySlug.entries()].map(([dirSlug, { meta, feature }]) => ({
    slug: meta.slug ?? dirSlug,
    title: meta.title ?? meta.slug ?? dirSlug,
    status: meta.status ?? "draft",
    created: meta.created ?? "",
    updated: meta.updated ?? meta.created ?? "",
    rounds: meta.rounds ?? 0,
    feature: feature || meta.feature || null,
  }));
  out.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
  return out;
}

function readReviews(dir) {
  const p = reviewsPathIn(dir);
  if (!fs.existsSync(p)) return [];
  const out = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip a corrupt line rather than fail the whole read
    }
  }
  return out;
}

// meta + reviews: [{at, round, prompts, ended_by}] | null if the plan doesn't
// exist in either layout.
export function getPlan(brain, slug) {
  const found = findPlanLocation(brain, slug);
  if (!found) return null;
  const meta = readJsonSafe(metaPathIn(found.dir));
  if (!meta) return null;
  return {
    ...meta,
    feature: found.feature || meta.feature || null,
    reviews: readReviews(found.dir),
    snapshots: listSnapshots(brain, found.dir),
  };
}

// Per-round artifact snapshots (vN.html) written by recordReviewRound — one
// per round, whether or not that round approved anything. The live `file` path
// keeps changing as the agent edits it, so anything checking "does the shipped
// thing match what was approved" has to read a snapshot, not the file — but it
// must pick the snapshot for the round that ENDED the review (`ended_by` set),
// not simply the newest. The newest is often a change-request draft.
function listSnapshots(brain, dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((name) => ({ name, m: /^v(\d+)\.html$/.exec(name) }))
    .filter((e) => e.m)
    // Forward slashes always: every other brain-relative ref in this module is
    // hand-built with "/", and these land in TOON output and a `help:` string.
    .map((e) => ({
      round: Number(e.m[1]),
      path: path.relative(brain, path.join(dir, e.name)).split(path.sep).join("/"),
    }))
    .sort((a, b) => a.round - b.round);
}

// Snapshot vN.html (N = rounds+1), append reviews.jsonl, bump meta rounds/
// updated/status per the state machine: draft -> in-review on first round,
// -> reviewed once a round carries endedBy. Resolves the existing plan's
// location (feature-bound or legacy) rather than assuming the legacy pool.
export function recordReviewRound(brain, slug, { prompts, endedBy, artifactPath }) {
  const found = findPlanLocation(brain, slug);
  const dir = found ? found.dir : planDirFor(brain, slug, null);
  fs.mkdirSync(dir, { recursive: true });
  const mp = metaPathIn(dir);
  const now = new Date().toISOString();
  let meta = readJsonSafe(mp);
  if (!meta) {
    meta = {
      slug,
      title: titleFromArtifact(artifactPath) || slug,
      file: path.resolve(artifactPath),
      feature: (found && found.feature) || null,
      status: "draft",
      created: now,
      updated: now,
      rounds: 0,
    };
  }

  const round = (meta.rounds || 0) + 1;
  const bytes = fs.readFileSync(artifactPath);
  // Atomic: this snapshot is the frozen record of what a human approved, so a
  // half-written vN.html would corrupt the only artifact that can answer
  // "does the shipped thing match what was reviewed?".
  writeFileAtomic(path.join(dir, `v${round}.html`), bytes);
  fs.appendFileSync(
    reviewsPathIn(dir),
    JSON.stringify({ at: now, round, prompts: prompts || [], ended_by: endedBy || null }) + "\n"
  );

  meta.rounds = round;
  meta.updated = now;
  if (endedBy) meta.status = "reviewed";
  else if (meta.status === "draft") meta.status = "in-review";
  writeFileAtomic(mp, JSON.stringify(meta, null, 2) + "\n");

  return { round };
}

// ---------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------

// [{feature, scope, file, rel, caption}] — exactly one of feature/scope is
// set per row. `rel` is resolvable relative to the `.brain` root itself (NOT
// relative to a screenshots/ subdir — the two layouts have different roots,
// so an unqualified rel would be ambiguous): `features/<slug>/screenshots/x`
// or `screenshots/<scope>/x`. `filter`, if given, matches either a feature
// slug or a legacy scope name (merged: "that feature's screenshots + legacy
// scope-matching ones").
export function listShots(brain, filter) {
  const out = [];

  for (const slug of listFeatureSlugs(brain)) {
    if (filter && slug !== filter) continue;
    const dir = featureScreenshotsDir(brain, slug);
    if (!fs.existsSync(dir)) continue;
    const captions = readJsonSafe(path.join(dir, "captions.json")) || {};
    for (const file of fs.readdirSync(dir)) {
      if (!SHOT_EXTS.has(path.extname(file).toLowerCase())) continue;
      out.push({
        feature: slug,
        scope: null,
        file,
        rel: path.posix.join("features", slug, "screenshots", file),
        caption: captions[file] || "",
      });
    }
  }

  const legacyRoot = legacyScreenshotsDir(brain);
  if (fs.existsSync(legacyRoot)) {
    const scopes = filter
      ? [filter]
      : fs
          .readdirSync(legacyRoot, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
    for (const s of scopes) {
      const dir = path.join(legacyRoot, s);
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      const captions = readJsonSafe(path.join(dir, "captions.json")) || {};
      for (const file of fs.readdirSync(dir)) {
        if (!SHOT_EXTS.has(path.extname(file).toLowerCase())) continue;
        out.push({
          feature: null,
          scope: s,
          file,
          rel: path.posix.join("screenshots", s, file),
          caption: captions[file] || "",
        });
      }
    }
  }

  return out;
}

// Copy imgPath into the brain's screenshot tree; returns {rel} (see listShots
// for the rel shape). Primary form: {feature, step} -> the PR-9 naming
// convention, filename becomes "<step><ext>" (e.g. "01-signin.png"),
// destination `.brain/features/<slug>/screenshots/`. Legacy form: {scope} ->
// keeps the source file's own basename, destination `.brain/screenshots/<scope>/`.
export function addShot(brain, imgPath, { feature, step, scope, caption }) {
  const ext = path.extname(imgPath);
  let dir, file, rel;

  if (feature) {
    dir = featureScreenshotsDir(brain, feature);
    file = step ? (path.extname(step) ? step : `${step}${ext}`) : path.basename(imgPath);
    rel = path.posix.join("features", feature, "screenshots", file);
  } else {
    dir = path.join(legacyScreenshotsDir(brain), scope);
    file = path.basename(imgPath);
    rel = path.posix.join("screenshots", scope, file);
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(imgPath, path.join(dir, file));

  if (caption) {
    const capPath = path.join(dir, "captions.json");
    const captions = readJsonSafe(capPath) || {};
    captions[file] = caption;
    writeFileAtomic(capPath, JSON.stringify(captions, null, 2) + "\n");
  }

  return { rel };
}

// ---------------------------------------------------------------------------
// Screenshot annotations (Phase 3) — pin+note markers a reviewer drops on a
// shot in the lightbox. Stored per-feature at
// features/<slug>/screenshots/annotations.json as an array of
//   { id, shot, x, y, note, at, shotMtimeMs, shotSize, superseded, sentAt }
// where `shot` is the brain-root-relative rel (same shape as listShots' rel),
// x/y are percentages (0-100, one decimal) of the rendered image, and
// shotMtimeMs/shotSize snapshot the shot file's stats at pin time. Round-1
// lifecycle: an annotation is SUPERSEDED (computed live on read, never a stored
// truth) once its shot file is replaced (different mtime/size) or removed.
//
// `sentAt` (Phase 4 — composer send step) is an ISO string once the reviewer
// has explicitly handed a batch of pins to the agent via markAnnotationsSent,
// else null. Records written before this field existed have no `sentAt` key
// at all; every reader here normalizes that absence to null rather than
// leaving it `undefined`, so callers can rely on a strict null check.
// ---------------------------------------------------------------------------

function annotationsPath(brain, slug) {
  return path.join(featureScreenshotsDir(brain, slug), "annotations.json");
}

function capStr(v, max) {
  if (typeof v !== "string") return "";
  return v.length > max ? v.slice(0, max) : v;
}

function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

// Read + parse annotations.json. Missing file -> []. Corrupt JSON throws a
// clean Error (callers map to HTTP 400/500 or CLI opError) rather than
// silently swallowing it like readJsonSafe — a reviewer's notes going missing
// unnoticed is worse than a loud failure.
function readAnnotationsFile(p) {
  if (!fs.existsSync(p)) return [];
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    throw new Error(`cannot read annotations at ${p}: ${e.message}`);
  }
  if (!raw.trim()) return [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`corrupt annotations JSON at ${p}: ${e.message}`);
  }
  return Array.isArray(data) ? data : [];
}

// Resolve the actual shot file for a brain-relative rel, refusing anything
// outside this feature's screenshots/ or the legacy screenshots/ tree (or
// traversal). Returns an absolute path, else null.
function resolveShotFile(brain, slug, shotRel) {
  if (typeof shotRel !== "string" || !shotRel) return null;
  if (shotRel.split("/").includes("..")) return null;
  const brainResolved = path.resolve(brain);
  const abs = path.resolve(brainResolved, shotRel);
  if (abs !== brainResolved && !abs.startsWith(brainResolved + path.sep)) return null;
  const featShots = path.resolve(featureScreenshotsDir(brain, slug));
  const legacyShots = path.resolve(legacyScreenshotsDir(brain));
  const under = abs.startsWith(featShots + path.sep) || abs.startsWith(legacyShots + path.sep);
  if (!under) return null;
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return abs;
}

// True once the annotation's shot file no longer matches the stats recorded at
// pin time — replaced (mtime/size differ) or removed (stat fails).
function isSuperseded(brain, a) {
  const abs = path.resolve(brain, a.shot || "");
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    return true; // missing shot file -> superseded
  }
  if (typeof a.shotMtimeMs === "number" && st.mtimeMs !== a.shotMtimeMs) return true;
  if (typeof a.shotSize === "number" && st.size !== a.shotSize) return true;
  return false;
}

// Read a feature's annotations with `superseded` recomputed live against the
// current shot files. Missing file -> []; corrupt JSON throws (see
// readAnnotationsFile). `sentAt` is passed through, normalized to null for
// older records that predate the field (see the section comment above).
export function listAnnotations(brain, slug) {
  return readAnnotationsFile(annotationsPath(brain, slug)).map((a) => ({
    ...a,
    superseded: isSuperseded(brain, a),
    sentAt: a.sentAt ?? null,
  }));
}

// Append one annotation for a shot that exists under this feature's (or the
// legacy) screenshots tree. Snapshots the shot file's stats for the supersede
// check, writes pretty JSON, returns the stored record. Throws on an unknown
// shot rel or corrupt existing file.
export function addAnnotation(brain, slug, { shot, x, y, note } = {}) {
  const abs = resolveShotFile(brain, slug, shot);
  if (!abs) throw new Error(`no screenshot at ${shot} under feature ${slug}`);
  const st = fs.statSync(abs);
  const p = annotationsPath(brain, slug);
  const list = readAnnotationsFile(p); // throws on corrupt before we append
  const rec = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    shot,
    x: clampPct(x),
    y: clampPct(y),
    note: capStr(note, 2000),
    at: new Date().toISOString(),
    shotMtimeMs: st.mtimeMs,
    shotSize: st.size,
    superseded: false,
    sentAt: null,
  };
  list.push(rec);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  writeFileAtomic(p, JSON.stringify(list, null, 2) + "\n");
  return rec;
}

// Remove one annotation by id. Throws a clean Error if no record matches
// (mirrors addAnnotation's throw-don't-swallow policy) or if the existing
// file is corrupt (via readAnnotationsFile).
export function removeAnnotation(brain, slug, id) {
  const p = annotationsPath(brain, slug);
  const list = readAnnotationsFile(p);
  const next = list.filter((a) => a.id !== id);
  if (next.length === list.length) throw new Error(`no annotation "${id}" for feature ${slug}`);
  writeFileAtomic(p, JSON.stringify(next, null, 2) + "\n");
}

// Stamp `sentAt` on every record still unsent (sentAt is null/absent),
// regardless of superseded — a superseded pin was still real feedback the
// reviewer chose to send, and re-stamping it is harmless. Returns
// {sent: <count>}; when nothing was unsent, count is 0 and the file is left
// untouched (no write) rather than rewritten byte-identical. Throws on a
// corrupt existing file (via readAnnotationsFile), mirroring addAnnotation.
export function markAnnotationsSent(brain, slug) {
  const p = annotationsPath(brain, slug);
  const list = readAnnotationsFile(p);
  const now = new Date().toISOString();
  let sent = 0;
  const next = list.map((a) => {
    if (a.sentAt) return a;
    sent++;
    return { ...a, sentAt: now };
  });
  if (sent === 0) return { sent: 0 };
  writeFileAtomic(p, JSON.stringify(next, null, 2) + "\n");
  return { sent };
}

// ---------------------------------------------------------------------------
// Verifications — feature-verifier browser-walk verdict docs
// ---------------------------------------------------------------------------

// parseVerdict moved to lib/state.js (imported above) so brainCheck and every
// display surface share ONE definition. The old local copy decided purely by
// emoji substring, so `**Verdict**: PASS (live smoke…)` returned "unknown" on
// every read surface while brainCheck — which only tested for the presence of
// `**Verdict**:` — passed the same file. Both forms are now accepted.

// [{feature, date, verdict, file}] newest first. `file` is brain-root-relative.
export function listVerifications(brain, feature) {
  const out = [];
  const slugs = feature ? [feature] : listFeatureSlugs(brain);
  for (const slug of slugs) {
    const dir = featureVerificationsDir(brain, slug);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      const date = f.replace(/\.md$/, "");
      let verdict = "unknown";
      try {
        verdict = parseVerdict(fs.readFileSync(path.join(dir, f), "utf8"));
      } catch {
        // unreadable file — report as unknown rather than throw
      }
      out.push({ feature: slug, date, verdict, file: path.posix.join("features", slug, "verifications", f) });
    }
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

// {meta: {feature, date, verdict, file}, body} | null.
export function getVerification(brain, feature, date) {
  const file = path.join(featureVerificationsDir(brain, feature), `${date}.md`);
  if (!fs.existsSync(file)) return null;
  const body = fs.readFileSync(file, "utf8");
  return {
    meta: {
      feature,
      date,
      verdict: parseVerdict(body),
      file: path.posix.join("features", feature, "verifications", `${date}.md`),
    },
    body,
  };
}

// ---------------------------------------------------------------------------
// Timeline (local reimplementation of progress.md parsing — bin/brain.js
// executes main() on import, so we never import it from here)
// ---------------------------------------------------------------------------

function progressEntries(brain) {
  const p = path.join(brain, "runs", "progress.md");
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, "utf8");
  const parts = raw.split(/\n---+\n/);
  const entries = [];
  for (const part of parts.slice(1)) {
    const m = part.match(/^\s*## (.+)$/m);
    if (!m) continue;
    const header = m[1].trim();
    const date = (header.match(/^(\d{4}-\d{2}-\d{2})/) || [null, ""])[1];
    const summary = header.replace(/^\d{4}-\d{2}-\d{2}\s*(?:\d{2}:\d{2}\s*(?:\(UTC\))?\s*)?[—-]*\s*/, "");
    entries.push({ date, summary });
  }
  return entries;
}

function lastCheckpoint(brain) {
  const entries = progressEntries(brain);
  if (!entries.length || !entries[0].date) return null;
  return { date: entries[0].date, summary: entries[0].summary };
}

function readFirstHeadingSafe(file) {
  try {
    const m = fs.readFileSync(file, "utf8").match(/^# (.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function collectRunNotes(dir, refPrefix, items) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".md") || f === "progress.md" || f.startsWith("_TEMPLATE")) continue;
    const m = f.match(/^(\d{4}-\d{2}-\d{2})-/);
    if (!m) continue;
    let summary = f.replace(/\.md$/, "");
    const h = readFirstHeadingSafe(path.join(dir, f));
    if (h) summary = h;
    items.push({ at: m[1], type: "run", summary, ref: `${refPrefix}/${f}` });
  }
}

// Merged newest-first: [{at: "YYYY-MM-DD", type, summary, ref}]. type is one
// of checkpoint | run | plan | plan-round | verification.
export function timeline(brain, { limit = 30 } = {}) {
  const items = [];

  for (const e of progressEntries(brain)) {
    if (!e.date) continue;
    items.push({ at: e.date, type: "checkpoint", summary: e.summary, ref: "runs/progress.md" });
  }

  collectRunNotes(legacyRunsDir(brain), "runs", items);
  for (const slug of listFeatureSlugs(brain)) {
    collectRunNotes(featureRunsDir(brain, slug), `features/${slug}/runs`, items);
  }

  for (const { root, feature } of planRoots(brain)) {
    if (!fs.existsSync(root)) continue;
    for (const slug of fs.readdirSync(root)) {
      const dir = path.join(root, slug);
      const meta = readJsonSafe(metaPathIn(dir));
      if (!meta) continue;
      const ref = feature ? `features/${feature}/plans/${slug}` : `plans/${slug}`;
      if (meta.created) {
        items.push({ at: meta.created.slice(0, 10), type: "plan", summary: meta.title || slug, ref });
      }
      for (const r of readReviews(dir)) {
        if (!r.at) continue;
        const n = (r.prompts || []).length;
        const summary = `round ${r.round}: ${n} prompt${n === 1 ? "" : "s"}${r.ended_by ? ` (ended by ${r.ended_by})` : ""}`;
        items.push({ at: r.at.slice(0, 10), type: "plan-round", summary, ref });
      }
    }
  }

  for (const v of listVerifications(brain)) {
    items.push({ at: v.date, type: "verification", summary: `${v.feature}: ${v.verdict}`, ref: v.file });
  }

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return items.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Feature summary (for planContext — read directly, never throw)
// ---------------------------------------------------------------------------

function featuresSummary(brain) {
  const list = readJsonSafe(path.join(brain, "features", "feature_list.json"));
  const features = (list && list.features) || [];
  const counts = {};
  for (const f of features) counts[f.status] = (counts[f.status] || 0) + 1;
  return {
    total: features.length,
    counts,
    in_progress: features.filter((f) => f.status === "in-progress").map((f) => f.slug),
  };
}

// ---------------------------------------------------------------------------
// planContext — chrome sidebar payload
// ---------------------------------------------------------------------------

export function planContext(brain, slug) {
  const full = getPlan(brain, slug);
  const plan = full
    ? { slug: full.slug, title: full.title, status: full.status, rounds: full.rounds, created: full.created, feature: full.feature || null }
    : null;
  const reviews = full ? full.reviews.slice(-5).reverse() : [];

  // Feature-bound plan: scope screenshots + verifications to that feature.
  // Otherwise (legacy / unbound), keep the pre-v4 behavior of listing every
  // screenshot and no verifications — this is the back-compat path.
  const screenshots = plan && plan.feature ? listShots(brain, plan.feature) : listShots(brain);
  const verifications = plan && plan.feature ? listVerifications(brain, plan.feature) : [];

  return {
    plan,
    plans: listPlans(brain).slice(0, 10),
    reviews,
    timeline: timeline(brain, { limit: 20 }),
    screenshots: screenshots.slice(0, 30),
    verifications: verifications.slice(0, 10),
    features: featuresSummary(brain),
    last_checkpoint: lastCheckpoint(brain),
  };
}

// ---------------------------------------------------------------------------
// Execution view (Addendum v6, v6.3/D2) — feature-scoped snapshot used by the
// review chrome's "Execution" sidebar section. Never throws: missing feature
// or missing subdirectories just produce empty arrays / an "unknown" feature.
// ---------------------------------------------------------------------------

export function executionContext(brain, featureSlug) {
  const list = readJsonSafe(path.join(brain, "features", "feature_list.json"));
  const features = (list && list.features) || [];
  const feat = features.find((f) => f.slug === featureSlug || f.id === featureSlug);

  const checkpoints = progressEntries(brain)
    .slice(0, 5)
    .map((e) => ({ date: e.date, summary: e.summary }));

  const runs = [];
  const runsDir = featureRunsDir(brain, featureSlug);
  if (fs.existsSync(runsDir)) {
    for (const f of fs.readdirSync(runsDir).filter((f) => f.endsWith(".md")).sort()) {
      runs.push({ name: f.replace(/\.md$/, ""), title: readFirstHeadingSafe(path.join(runsDir, f)) || f.replace(/\.md$/, "") });
    }
  }

  const verifications = listVerifications(brain, featureSlug).map((v) => ({ date: v.date, verdict: v.verdict, file: v.file }));
  const shots = listShots(brain, featureSlug).map((s) => ({ rel: s.rel, caption: s.caption }));

  // Annotations feed both review surfaces' lightboxes as opts.annotations.
  // listAnnotations throws on a corrupt file; this context must never throw, so
  // a bad file degrades to no pins rather than a broken sidebar/dashboard.
  let annotations = [];
  try {
    annotations = listAnnotations(brain, featureSlug).map((a) => ({
      id: a.id,
      shot: a.shot,
      x: a.x,
      y: a.y,
      note: a.note,
      at: a.at || null,
      superseded: a.superseded,
      sentAt: a.sentAt,
    }));
  } catch {
    annotations = [];
  }

  return {
    feature: feat
      ? { slug: feat.slug, status: feat.status, evidence: feat.evidence || "" }
      : { slug: featureSlug, status: "unknown", evidence: "" },
    checkpoints,
    runs,
    verifications,
    shots,
    annotations,
  };
}

// ---------------------------------------------------------------------------
// Execution CLI verbs (Addendum v6, v6.4/D4)
// ---------------------------------------------------------------------------

// Append a verbatim step to a feature's run note (deep execution state, as
// opposed to runs/progress.md which stays a rolling cursor). Creates the note
// with a top-level heading if missing. Returns {file (brain-relative, posix),
// stepNumber}.
export function appendRunStep(brain, feature, { note, step, observed } = {}) {
  const dir = featureRunsDir(brain, feature);
  fs.mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const filename = note && note.trim() ? note.trim().replace(/\.md$/, "") + ".md" : `${date}-progress.md`;
  const file = path.join(dir, filename);

  let content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : `# ${feature} run — ${date}\n`;
  const stepNumber = (content.match(/^## Step \d+/gm) || []).length + 1;
  content += `\n## Step ${stepNumber} — ${step}\n\n\`\`\`\n${observed}\n\`\`\`\n`;
  writeFileAtomic(file, content);

  return { file: path.posix.join("features", feature, "runs", filename), stepNumber };
}

// ---------------------------------------------------------------------------
// Execution dashboard (Addendum v8 — /watch surface)
// ---------------------------------------------------------------------------

// True when the slug (or id) is present in feature_list.json. The /watch
// routes 404 on unknown features instead of rendering an empty dashboard.
export function featureExists(brain, slug) {
  const list = readJsonSafe(path.join(brain, "features", "feature_list.json"));
  const features = (list && list.features) || [];
  return features.some((f) => f.slug === slug || f.id === slug);
}

// Parse one run note's markdown into structured steps. Steps are the blocks
// appendRunStep writes: "## Step N — <title>" followed by a ``` fence of
// verbatim observed output. Output per step is capped so a single huge log
// cannot bloat the dashboard payload; the tail points at the source file.
const STEP_OBSERVED_CAP = 8000;

function parseRunSteps(content, relFile) {
  const steps = [];
  const re = /^## Step (\d+)(?:\s+—\s+(.*))?$/gm;
  const matches = [];
  let m;
  while ((m = re.exec(content)) !== null) matches.push({ n: Number(m[1]), title: (m[2] || "").trim(), at: m.index, end: re.lastIndex });
  for (let i = 0; i < matches.length; i++) {
    const body = content.slice(matches[i].end, i + 1 < matches.length ? matches[i + 1].at : content.length);
    const fence = body.match(/```[^\n]*\n([\s\S]*?)```/);
    let observed = fence ? fence[1].replace(/\n$/, "") : body.trim();
    let truncated = false;
    if (observed.length > STEP_OBSERVED_CAP) {
      observed = observed.slice(0, STEP_OBSERVED_CAP) + `\n… (truncated — see ${relFile})`;
      truncated = true;
    }
    steps.push({ n: matches[i].n, title: matches[i].title, observed, truncated });
  }
  return steps;
}

// All run notes for a feature with their parsed steps, oldest note first.
export function listRunSteps(brain, feature) {
  const dir = featureRunsDir(brain, feature);
  const notes = [];
  if (!fs.existsSync(dir)) return notes;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const rel = path.posix.join("features", feature, "runs", f);
    let content = "";
    try { content = fs.readFileSync(path.join(dir, f), "utf8"); } catch { continue; }
    notes.push({
      name: f.replace(/\.md$/, ""),
      title: readFirstHeadingSafe(path.join(dir, f)) || f.replace(/\.md$/, ""),
      file: rel,
      steps: parseRunSteps(content, rel),
    });
  }
  return notes;
}

// PR record — the dashboard's terminal state. features/<slug>/pr.json:
// {url, opened_at}. Written once by `brain pr`; re-recording overwrites.
export function getPr(brain, feature) {
  const rec = readJsonSafe(path.join(featureDir(brain, feature), "pr.json"));
  return rec && typeof rec.url === "string" ? { url: rec.url, opened_at: rec.opened_at || "" } : null;
}

export function recordPr(brain, feature, url) {
  const dir = featureDir(brain, feature);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "pr.json");
  writeFileAtomic(file, JSON.stringify({ url, opened_at: new Date().toISOString() }, null, 2) + "\n");
  return { file: path.posix.join("features", feature, "pr.json") };
}

// Everything the /watch dashboard renders, in one payload: the sidebar
// execution context plus parsed run steps and the PR record.
export function watchContext(brain, feature) {
  const ctx = executionContext(brain, feature);
  ctx.run_steps = listRunSteps(brain, feature);
  ctx.pr = getPr(brain, feature);
  return ctx;
}

function resolveFeatureDocPath(brain, feat) {
  if (feat.doc) {
    const direct = path.resolve(brain, "..", feat.doc);
    if (fs.existsSync(direct)) return direct;
  }
  if (feat.slug) {
    const perFeature = path.join(featureDir(brain, feat.slug), `${feat.slug}.md`);
    if (fs.existsSync(perFeature)) return perFeature;
    const legacyFlat = path.join(brain, "features", `${feat.slug}.md`);
    if (fs.existsSync(legacyFlat)) return legacyFlat;
  }
  return null;
}

// Deterministic invariants over the whole brain, each {check, status: "pass"|
// "fail", detail}. Never throws — any unexpected read failure is folded into
// a failing check rather than propagated.
// `opts.list` validates a PROJECTED feature list instead of the one on disk, so
// a caller can ask "would the brain still be coherent if I wrote this?" without
// writing it. That is what makes `brain ship` preflight possible: it used to
// write state, then check, then exit 1 leaving the bad state behind.
export function brainCheck(brain, opts = {}) {
  const checks = [];
  const projected = opts.list;
  try {
    // Structural validation, not just JSON.parse. The old check asserted only
    // that the bytes parsed, so `{}`, `[]`, `"hello"`, `42`, and a non-array
    // `features` all passed — and the line below silently coerced them to an
    // empty list, which then passed every downstream check too.
    const flPath = path.join(brain, "features", "feature_list.json");
    let list = null;
    if (projected !== undefined) {
      const shapeError = validateFeatureListShape(projected);
      if (shapeError) {
        checks.push({ check: "feature_list.json is valid", status: "fail", detail: shapeError });
      } else {
        list = projected;
        checks.push({
          check: "feature_list.json is valid",
          status: "pass",
          detail: `${projected.features.length} feature(s), schema valid (projected)`,
        });
      }
    } else if (!fs.existsSync(flPath)) {
      checks.push({ check: "feature_list.json is valid", status: "fail", detail: "missing features/feature_list.json" });
    } else {
      let parsed = null;
      let parseError = null;
      try {
        parsed = JSON.parse(fs.readFileSync(flPath, "utf8"));
      } catch (e) {
        parseError = e.message;
      }
      if (parseError) {
        checks.push({ check: "feature_list.json is valid", status: "fail", detail: `not valid JSON: ${parseError}` });
      } else {
        const shapeError = validateFeatureListShape(parsed);
        if (shapeError) {
          checks.push({ check: "feature_list.json is valid", status: "fail", detail: shapeError });
        } else {
          list = parsed;
          checks.push({
            check: "feature_list.json is valid",
            status: "pass",
            detail: `${parsed.features.length} feature(s), schema valid`,
          });
        }
      }
    }
    // Only a schema-valid list feeds the checks below; an invalid one yields []
    // so they report emptily rather than crashing on a bad shape.
    const features = (list && list.features) || [];

    // Shared helper, so the checker and cmdFeaturesSetStatus cannot drift apart
    // again. Absent policy enforces (the historical default here); only an
    // explicit `false` opts out.
    const policyOn = oneInProgressEnforced(list);
    const inProgress = features.filter((f) => f.status === "in-progress");
    checks.push({
      check: "at most one feature in-progress",
      status: !policyOn || inProgress.length <= 1 ? "pass" : "fail",
      detail: !policyOn
        ? `${inProgress.length} in-progress (policy one_in_progress_at_a_time: false — not enforced)`
        : inProgress.length <= 1
          ? `${inProgress.length} in-progress`
          : `${inProgress.length} in-progress: ${inProgress.map((f) => f.slug).join(", ")}`,
    });

    const missingDocs = features.filter((f) => !resolveFeatureDocPath(brain, f)).map((f) => f.slug || f.id || "?");
    checks.push({
      check: "every feature doc path resolves",
      status: missingDocs.length ? "fail" : "pass",
      detail: missingDocs.length ? `missing doc for: ${missingDocs.join(", ")}` : `${features.length} feature doc(s) checked`,
    });

    // features/index.md is a hand-maintained mirror of feature_list.json, and
    // nothing compared them — so a feature could read `shipped` in the tracker
    // and `in-progress` in the human-facing index with every check green. That
    // is state degradation: whichever one a reader happens to open decides what
    // they believe. Until the index is generated, at least make the drift fail.
    // NOT checked in projection mode. features/index.md is a DERIVED artifact
    // generated FROM the tracker, so it can only ever describe what is on disk.
    // Comparing it against a proposed next state is category-confused, and it
    // deadlocked `brain ship` in every brain that had an index: the projection
    // said `shipped`, the on-disk index still said `in-progress` (correctly —
    // nothing had shipped yet), so the ship was refused, and the only way out
    // was to hand-edit the index to a premature `shipped`. A gate that can only
    // be satisfied by lying is worse than no gate. Ship regenerates the index
    // after a successful write instead.
    const indexPath = path.join(brain, "features", "index.md");
    const drift = [];
    let indexRows = 0;
    const skipIndexCheck = projected !== undefined;
    if (skipIndexCheck) {
      checks.push({
        check: "features/index.md agrees with the tracker",
        status: "pass",
        detail: "not applicable to a projected state — the index is generated from the tracker",
      });
    } else if (!fs.existsSync(indexPath) && features.length) {
      // A MISSING index is not agreement. Deleting the file used to be the
      // cheapest way to silence the check permanently.
      checks.push({
        check: "features/index.md agrees with the tracker",
        status: "fail",
        detail: `missing features/index.md while ${features.length} feature(s) are tracked — run \`brain features index --write --create\``,
      });
    } else if (fs.existsSync(indexPath) && features.length) {
      let indexText = "";
      try {
        indexText = fs.readFileSync(indexPath, "utf8");
      } catch (e) {
        drift.push(`features/index.md unreadable: ${e.message}`);
      }
      const linkedSlugs = new Set();
      for (const line of indexText.split("\n")) {
        // Must be an actual table ROW, not merely a line containing a pipe.
        // Prose like "the pipeline was **blocked** by CI" that happens to link a
        // feature doc was being judged as a status row and reported as drift.
        if (!/^\s*\|/.test(line)) continue;
        // Attribute by doc link, and to EVERY feature the row links — a
        // first-match-wins lookup hid drift on the second link in a row.
        const linked = features.filter(
          (f) => f.slug && (line.includes(`${f.slug}/${f.slug}.md`) || line.includes(`(${f.slug}.md)`))
        );
        if (!linked.length) continue;
        for (const f of linked) linkedSlugs.add(f.slug);
        // Case-insensitive: an index writing "Shipped" used to match nothing and
        // silently skip the row instead of comparing it.
        const found = STATUSES.filter((s) => new RegExp(`(^|[^a-z-])${s}([^a-z-]|$)`, "i").test(line));
        if (found.length === 0) {
          // Unverifiable, not fine. A row that links a feature but carries no
          // recognizable status silently skipped — so "in progress" (a space
          // instead of a hyphen) passed regardless of the tracker.
          drift.push(
            `${linked.map((f) => f.slug).join("/")}: index.md row links the feature but has no recognizable status (expected one of ${STATUSES.join("|")})`
          );
          continue;
        }
        if (found.length > 1) {
          // Unverifiable is not the same as fine. Skipping let a row reading
          // "was in-progress, now shipped" pass regardless of the tracker.
          drift.push(
            `${linked.map((f) => f.slug).join("/")}: index.md row has ${found.length} status words (${found.join(", ")}) — cannot verify`
          );
          continue;
        }
        for (const feat of linked) {
          indexRows++;
          if (found[0].toLowerCase() !== feat.status)
            drift.push(`${feat.slug}: tracker "${feat.status}" vs index.md "${found[0]}"`);
        }
      }
      // Both directions: a feature present in the tracker but absent from the
      // index is exactly how the index fell two features behind unnoticed.
      const missingFromIndex = features.filter((f) => f.slug && !linkedSlugs.has(f.slug));
      if (missingFromIndex.length)
        // Not gated on linkedSlugs.size any more: a GUTTED index (zero linked
        // rows) reported "no rows to compare" and passed, which made deleting
        // the table the easiest way to silence the check.
        drift.push(`not listed in index.md: ${missingFromIndex.map((f) => f.slug).join(", ")}`);
    }
    if (!skipIndexCheck && fs.existsSync(indexPath) && features.length) checks.push({
      check: "features/index.md agrees with the tracker",
      status: drift.length ? "fail" : "pass",
      detail: drift.length
        ? drift.join(", ")
        : indexRows
          ? `${indexRows} index row(s) checked`
          : "no index.md status rows to compare",
    });

    const knownIds = new Set(features.flatMap((f) => [f.id, f.slug].filter(Boolean)));
    const badDeps = [];
    for (const f of features) {
      for (const dep of f.dependencies || []) {
        if (!knownIds.has(dep)) badDeps.push(`${f.slug || f.id} -> ${dep}`);
      }
    }
    checks.push({
      check: "dependency refs resolve",
      status: badDeps.length ? "fail" : "pass",
      detail: badDeps.length ? badDeps.join(", ") : "all dependency refs resolve",
    });

    const progressPath = path.join(brain, "runs", "progress.md");
    checks.push({
      check: "runs/progress.md exists",
      status: fs.existsSync(progressPath) ? "pass" : "fail",
      detail: fs.existsSync(progressPath) ? "" : "missing runs/progress.md",
    });

    let planCount = 0;
    const planBad = [];
    let reviewLineCount = 0;
    const reviewBad = [];
    for (const { root } of planRoots(brain)) {
      if (!fs.existsSync(root)) continue;
      for (const slug of fs.readdirSync(root)) {
        const dir = path.join(root, slug);
        const mp = metaPathIn(dir);
        if (fs.existsSync(mp)) {
          planCount++;
          try {
            JSON.parse(fs.readFileSync(mp, "utf8"));
          } catch (e) {
            planBad.push(`${slug}/meta.json: ${e.message}`);
          }
        }
        const rp = reviewsPathIn(dir);
        if (fs.existsSync(rp)) {
          fs.readFileSync(rp, "utf8")
            .split("\n")
            .forEach((line, i) => {
              if (!line.trim()) return;
              reviewLineCount++;
              try {
                JSON.parse(line);
              } catch {
                reviewBad.push(`${slug}/reviews.jsonl:${i + 1}`);
              }
            });
        }
      }
    }
    checks.push({
      check: "plan meta.json files parse",
      status: planBad.length ? "fail" : "pass",
      detail: planBad.length ? planBad.join("; ") : `${planCount} plan(s) checked`,
    });
    checks.push({
      check: "reviews.jsonl lines parse",
      status: reviewBad.length ? "fail" : "pass",
      detail: reviewBad.length ? reviewBad.join(", ") : `${reviewLineCount} review round(s) checked`,
    });

    // A verdict must be READABLE, not merely present. The old test was
    // /\*\*Verdict\*\*:/ — presence only — so a line the display parser scored
    // as "unknown" still passed here. Now both use parseVerdictDetail.
    let verCount = 0;
    const verBad = [];
    const shotBad = [];
    for (const slug of listFeatureSlugs(brain)) {
      const dir = featureVerificationsDir(brain, slug);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".md")) continue;
        verCount++;
        const rel = `${slug}/verifications/${f}`;
        let content = null;
        try {
          content = fs.readFileSync(path.join(dir, f), "utf8");
        } catch (e) {
          verBad.push(`${rel}: ${e.message}`);
          continue;
        }
        const { verdict, hasLine } = parseVerdictDetail(content);
        if (!hasLine) verBad.push(`${rel}: no **Verdict**: line`);
        else if (verdict === "unknown") verBad.push(`${rel}: unreadable verdict`);

        // Citing evidence is not the same as having it: a verdict doc's
        // screenshot links were never validated, so a doc could point at
        // images that do not exist and still pass.
        for (const m of content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
          const target = m[1].trim();
          if (/^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
          if (!fs.existsSync(path.resolve(dir, target))) shotBad.push(`${rel} -> ${target}`);
        }
      }
    }
    checks.push({
      check: "verification docs have a readable Verdict",
      status: verBad.length ? "fail" : "pass",
      detail: verBad.length
        ? `${verBad.join(", ")} (accepted: ${VERDICT_ACCEPTED})`
        : `${verCount} verification doc(s) checked`,
    });
    checks.push({
      check: "verification doc image links resolve",
      status: shotBad.length ? "fail" : "pass",
      detail: shotBad.length ? shotBad.join(", ") : `${verCount} verification doc(s) checked`,
    });

    // shipped ⇒ a PASS verification doc. This is the victory-declaration gate:
    // `evidence` is a free-text string nobody validates, so without this a
    // feature could be marked shipped on the strength of a sentence.
    //
    // Opt-in for ambient `brain check` (existing brains predate it and would go
    // red on upgrade — read-compat, per rules/state.md) but ALWAYS enforced by
    // the ship path, which is where the claim is actually made.
    if (opts.strict) {
      const repoRoot = path.dirname(path.resolve(brain));
      const inRepo = isGitRepo(repoRoot);
      // SCOPE. `opts.strictScope` limits the proof requirement to one slug.
      //
      // Without it, the ship path — which is always strict — preflighted the
      // WHOLE brain, so a single legacy feature that predates the invariant
      // refused every future ship in the repo. That made the flagship gate
      // decorative in exactly the two repos that own it: you cannot ship
      // anything until you retroactively verify everything, which nobody will
      // do, so the gate gets bypassed instead of satisfied.
      //
      // Shipping X asserts that X works. It does not assert that a feature
      // someone shipped a year ago has a receipt. Ambient `brain check --strict`
      // still audits the whole brain — that is the report; this is the gate.
      // Grandfathered slugs shipped before the invariant existed. Exempting them
      // by an explicit committed list is what lets strict be a real GATE rather
      // than an advisory: new ships must prove themselves, legacy debt stays
      // visible and enumerable, and nothing is fabricated. A slug being on the
      // list never exempts anything else.
      const grandfathered = strictGrandfathered(list);
      const shipped = features.filter(
        (f) =>
          f.status === "shipped" &&
          (!opts.strictScope || f.slug === opts.strictScope) &&
          !grandfathered.has(f.slug)
      );
      // A grandfathered feature that CAN now be proven should leave the list —
      // the ratchet only tightens.
      // "Provable" means it satisfies strict FULLY — a PASS *and* a receipt whose
      // commit resolves. Firing on a PASS alone was wrong: several legacy docs
      // have a verdict but predate receipts entirely, so they belong on the list
      // for the receipt requirement even though the verdict is there.
      const fullyProven = (slug) => {
        const passing = listVerifications(brain, slug).filter((d) => d.verdict === "PASS");
        if (!passing.length) return false;
        return passing.some((d) => {
          let content = "";
          try {
            content = fs.readFileSync(path.resolve(brain, d.file), "utf8");
          } catch {
            return false;
          }
          const r = parseReceipt(content);
          if (!r.present || !r.commit) return false;
          if (!isGitRepo(repoRoot)) return true;
          return gitCommitExists(repoRoot, r.commit) && gitIsAncestor(repoRoot, r.commit);
        });
      };
      const provable = features
        .filter((f) => f.status === "shipped" && grandfathered.has(f.slug))
        .filter((f) => fullyProven(f.slug))
        .map((f) => f.slug);
      if (provable.length && !opts.strictScope)
        checks.push({
          check: "strict grandfather list only shrinks",
          status: "fail",
          detail: `now provable — remove from policy.strict_grandfathered: ${provable.join(", ")}`,
        });
      // When scoped to a slug that is not becoming shipped there is nothing to
      // prove, so emit no rows rather than a vacuous pass.
      const scopedNoop = Boolean(opts.strictScope) && shipped.length === 0;
      if (!scopedNoop) {
      const unproven = [];
      const unbound = [];
      for (const f of shipped) {
        const docs = listVerifications(brain, f.slug);
        const passing = docs.filter((d) => d.verdict === "PASS");
        if (!passing.length) {
          const had = docs.length;
          unproven.push(`${f.slug}${had ? ` (${had} doc(s), none PASS)` : " (no verification doc)"}`);
          continue;
        }
        // A PASS is not evidence unless it is bound to code. Accept the feature
        // if ANY passing doc carries a usable receipt — re-verifying should not
        // require deleting history.
        let bound = false;
        const reasons = [];
        for (const d of passing) {
          let content = "";
          try {
            content = fs.readFileSync(path.resolve(brain, d.file), "utf8");
          } catch (e) {
            reasons.push(`${d.date}: unreadable (${e.message})`);
            continue;
          }
          const receipt = parseReceipt(content);
          if (!receipt.present) {
            reasons.push(`${d.date}: no brain:verification receipt`);
            continue;
          }
          if (!receipt.commit) {
            reasons.push(`${d.date}: receipt has no commit`);
            continue;
          }
          if (!inRepo) {
            // Outside a repo we cannot verify provenance, and refusing would
            // break harnesses in non-git directories. Presence is the ceiling.
            bound = true;
            break;
          }
          if (!gitCommitExists(repoRoot, receipt.commit)) {
            reasons.push(`${d.date}: commit ${receipt.commit} not in this repo`);
            continue;
          }
          if (!gitIsAncestor(repoRoot, receipt.commit)) {
            reasons.push(`${d.date}: commit ${receipt.commit} is not an ancestor of HEAD (verified on code that never landed)`);
            continue;
          }
          bound = true;
          break;
        }
        if (!bound) unbound.push(`${f.slug} — ${reasons.join("; ")}`);
      }
      checks.push({
          check: "every shipped feature has a PASS verification",
          status: unproven.length ? "fail" : "pass",
          detail: unproven.length
            ? unproven.join(", ")
            : `${shipped.length} shipped feature(s) proven`,
        });
      checks.push({
          check: "every PASS verification is bound to a commit",
          status: unbound.length ? "fail" : "pass",
          detail: unbound.length
            ? `${unbound.join(" | ")} (add: ${RECEIPT_SNIPPET.split("\n").join(" ")})`
            : inRepo
              ? `${shipped.length - unproven.length} receipt(s) resolve to an ancestor of HEAD`
              : "not a git repo — receipt presence checked, provenance unverifiable",
        });
      }
    }
  } catch (e) {
    checks.push({ check: "brainCheck ran without error", status: "fail", detail: e.message });
  }
  return checks;
}
