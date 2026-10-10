// lib/brain/verifications.js — verdicts bound to the commit they were taken on.

import fs from "node:fs";
import path from "node:path";
import { BrainError } from "./errors.js";
import { lookup } from "./features.js";
import { gitAuthor, gitDirty, gitHead, now, plain, relToRoot, sha256File, tx } from "./util.js";

export const VERDICTS = ["PASS", "FAIL", "BLOCKED"];

const SELECT = `SELECT v.id, f.slug AS feature, v.verdict, v.round, v.body, v.commit_sha AS "commit",
  v.verified_by, v.implemented_by, v.dirty, v.at
  FROM verifications v JOIN features f ON f.id = v.feature_id`;

function shape(db, row, withShots) {
  const v = plain(row);
  v.dirty = !!v.dirty;
  if (withShots)
    v.shots = db.prepare("SELECT path, sha256, caption FROM shots WHERE verification_id = ? ORDER BY id").all(v.id).map(plain);
  return v;
}

// Newest first; `feature` filters by slug. Bodies are included.
export function list(db, { feature } = {}) {
  const fid = feature ? lookup(db, feature).id : null;
  return db
    .prepare(`${SELECT} ${fid ? "WHERE v.feature_id = ?" : ""} ORDER BY v.at DESC, v.id DESC`)
    .all(...(fid ? [fid] : []))
    .map((r) => shape(db, r, false));
}

// One verification with shots: `round` or the latest.
export function get(db, slug, round) {
  const f = lookup(db, slug);
  const row =
    round === undefined || round === null
      ? db.prepare(`${SELECT} WHERE v.feature_id = ? ORDER BY v.round DESC LIMIT 1`).get(f.id)
      : db.prepare(`${SELECT} WHERE v.feature_id = ? AND v.round = ?`).get(f.id, Number(round));
  if (!row)
    throw new BrainError("NOT_FOUND", `no verification for ${f.slug}${round ? ` round ${round}` : ""}`, [
      `brain verifications add ${f.slug} --verdict PASS|FAIL|BLOCKED --body "..."`,
    ]);
  return shape(db, row, true);
}

// { verdict, round, commit, at } of the newest round, or null.
export function latestVerdict(db, slug) {
  const f = lookup(db, slug);
  const row = db
    .prepare('SELECT verdict, round, commit_sha AS "commit", dirty, at FROM verifications WHERE feature_id = ? ORDER BY round DESC LIMIT 1')
    .get(f.id);
  return row ? { ...row, dirty: !!row.dirty } : null;
}

// Record a verdict as the next round. Stamps the commit of `root` (the checkout
// being verified) and dirty:true when the tree has uncommitted changes (#11).
// `shots` are files under the shared brain's gitignored `.brain/shots/` in the
// MAIN checkout (`mainRoot`; every worktree shares that one brain.db), stored
// as path + sha256 relative to mainRoot (the image never enters the DB or git).
// A shot path may be absolute or relative to `cwd`, `root` or `mainRoot`.
// Screenshots live here (gitignored by `init`); only their paths are recorded.
export const SHOTS_DIR = ".brain/shots";

// Where a feature's screenshots go, for help lines: relative in the main
// checkout, absolute from a worktree (whose own .brain/shots/ is refused).
export function shotsDirHint(slug, { root, mainRoot = root } = {}) {
  const sub = slug ? `${SHOTS_DIR}/${slug}` : SHOTS_DIR;
  return root && mainRoot && path.resolve(root) !== path.resolve(mainRoot) ? `${path.join(mainRoot, sub)}/` : `${sub}/`;
}

function resolveShot(file, bases) {
  for (const base of bases) {
    const abs = path.resolve(base, file);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return fs.realpathSync(abs);
  }
  return null;
}

export function add(
  db,
  slug,
  { verdict, body, shots = [], verifiedBy = "feature-verifier", implementedBy, root = process.cwd(), mainRoot = root, cwd = root } = {}
) {
  if (!VERDICTS.includes(verdict))
    throw new BrainError("INVALID_VERDICT", `invalid verdict "${verdict}"`, [`valid verdicts: ${VERDICTS.join(", ")}`]);
  if (typeof body !== "string" || !body.trim())
    throw new BrainError("INVALID_ARG", "body is required — the verifier's walk, verbatim", [
      `brain verifications add ${slug} --verdict ${verdict} --body "..."`,
    ]);
  const files = shots.map((s) => (typeof s === "string" ? { path: s } : s));
  const base = fs.existsSync(mainRoot) ? fs.realpathSync(mainRoot) : path.resolve(mainRoot);
  const saveHint = `Save screenshots under ${shotsDirHint(slug, { root, mainRoot })}, then pass that path`;
  const recorded = files.map((s) => {
    const abs = resolveShot(s.path, [...new Set([cwd, root, mainRoot])]);
    if (!abs) throw new BrainError("SHOT_MISSING", `shot ${s.path} does not exist`, ["Capture the screenshot first, then pass its path", saveHint]);
    const rel = relToRoot(base, abs);
    if (!rel.startsWith(`${SHOTS_DIR}/`))
      throw new BrainError(
        "SHOT_OUTSIDE_SHOTS_DIR",
        `shot ${s.path} is outside ${shotsDirHint(null, { root, mainRoot })} (gitignored; worktrees save into the main checkout's)`,
        [saveHint]
      );
    return { path: rel, sha256: sha256File(abs), caption: s.caption || null };
  });
  const commit = gitHead(root);
  const dirty = commit ? gitDirty(root) === true : false;
  const implemented = implementedBy || (commit ? gitAuthor(root) : null);
  return tx(db, () => {
    const f = lookup(db, slug);
    const round = db.prepare("SELECT coalesce(max(round), 0) + 1 AS r FROM verifications WHERE feature_id = ?").get(f.id).r;
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO verifications (feature_id, verdict, round, body, commit_sha, verified_by, implemented_by, dirty, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(f.id, verdict, round, body, commit, verifiedBy, implemented, dirty ? 1 : 0, now());
    const ins = db.prepare("INSERT INTO shots (verification_id, path, sha256, caption) VALUES (?, ?, ?, ?)");
    for (const s of recorded) ins.run(lastInsertRowid, s.path, s.sha256, s.caption);
    return get(db, f.slug, round);
  });
}
