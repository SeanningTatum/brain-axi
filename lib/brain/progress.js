// lib/brain/progress.js — checkpoints: the rolling "where are we" cursor.

import { BrainError } from "./errors.js";
import { lookup } from "./features.js";
import { NAME_RE, SUMMARY_MAX_CHARS, charLength, clipChars, gitBranch, now, plain, tx } from "./util.js";

const SELECT = `SELECT c.id, c.at, c.branch, c.summary, c.next, c.body, f.slug AS feature, c.run
  FROM checkpoints c LEFT JOIN features f ON f.id = c.feature_id`;

// Newest first. `feature` filters by slug.
export function list(db, { limit = 10, feature } = {}) {
  const fid = feature ? lookup(db, feature).id : null;
  return db
    .prepare(`${SELECT} ${fid ? "WHERE c.feature_id = ?" : ""} ORDER BY c.id DESC LIMIT ?`)
    .all(...(fid ? [fid] : []), limit)
    .map(plain);
}

export function latest(db) {
  return plain(db.prepare(`${SELECT} ORDER BY c.id DESC LIMIT 1`).get());
}

export function get(db, id) {
  const row = db.prepare(`${SELECT} WHERE c.id = ?`).get(Number(id));
  if (!row)
    throw new BrainError("NOT_FOUND", `no checkpoint ${id}`, ["brain progress list"]);
  return plain(row);
}

// Add a checkpoint. A summary over 200 characters throws SUMMARY_TOO_LONG,
// or is clipped with a trailing … when `clip` is set — never a silent cut (#5).
// `run` links a run note by name (#9). `branch` defaults to the git branch of
// `root` ("none" without git).
export function add(db, { summary, next = null, body = null, branch, feature, run = null, clip = false, root = process.cwd() } = {}) {
  if (typeof summary !== "string" || !summary.trim())
    throw new BrainError("INVALID_ARG", "summary is required", ['brain progress add --summary "<one line>"']);
  summary = summary.trim();
  const len = charLength(summary);
  if (len > SUMMARY_MAX_CHARS) {
    if (!clip)
      throw new BrainError("SUMMARY_TOO_LONG", `summary is ${len} characters; the limit is ${SUMMARY_MAX_CHARS}`, [
        "Shorten the summary to one line; put the detail in --body",
      ]);
    summary = clipChars(summary, SUMMARY_MAX_CHARS);
  }
  if (run !== null && (typeof run !== "string" || !NAME_RE.test(run)))
    throw new BrainError("INVALID_NAME", `invalid run name "${run}" — letters, digits, ".", "_" and "-"`, [
      "brain runs view <feature> to list run names",
    ]);
  const br = branch || gitBranch(root) || "none";
  return tx(db, () => {
    const fid = feature ? lookup(db, feature).id : null;
    const { lastInsertRowid } = db
      .prepare("INSERT INTO checkpoints (at, branch, summary, next, body, feature_id, run) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(now(), br, summary, next, body, fid, run);
    return get(db, lastInsertRowid);
  });
}
