// lib/brain/plans.js — reviewed plan artifacts. The HTML stays a file; the
// row keeps its path + sha256, the review rounds and the prompts per round.

import fs from "node:fs";
import path from "node:path";
import { BrainError } from "./errors.js";
import { lookup as lookupFeature } from "./features.js";
import { NAME_RE, now, plain, relToRoot, sha256File, tx } from "./util.js";

export const STATUSES = ["draft", "in-review", "reviewed", "approved"];

const SELECT = `SELECT p.id, p.slug, p.title, p.file_path, p.sha256, f.slug AS feature, p.status, p.rounds,
  p.approved_by, p.session_open, p.session_port, p.session_started, p.created, p.updated
  FROM plans p LEFT JOIN features f ON f.id = p.feature_id`;

function shape(row) {
  const p = plain(row);
  p.session_open = !!p.session_open;
  return p;
}

function lookup(db, slug) {
  const row = db.prepare(`${SELECT} WHERE p.slug = ?`).get(String(slug));
  if (!row)
    throw new BrainError("NOT_FOUND", `no plan "${slug}"`, ["brain plans list", "Register one: brain review open <plan.html>"]);
  return shape(row);
}

const titleFromHtml = (file) => {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(fs.readFileSync(file, "utf8"));
  return m ? m[1].replace(/\s+/g, " ").trim() || null : null;
};

const slugFromFile = (file) => path.basename(file).replace(/\.html?$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-");

// Newest updated first; filters by feature slug or status.
export function list(db, { feature, status } = {}) {
  const where = [];
  const args = [];
  if (feature) (where.push("p.feature_id = ?"), args.push(lookupFeature(db, feature).id));
  if (status) (where.push("p.status = ?"), args.push(status));
  return db
    .prepare(`${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY p.updated DESC, p.id DESC`)
    .all(...args)
    .map(shape);
}

// The plan with every round and its prompts.
export function get(db, slug) {
  const p = lookup(db, slug);
  p.reviews = db
    .prepare("SELECT id, round, at, ended_by, snapshot_path, snapshot_sha256 FROM review_rounds WHERE plan_id = ? ORDER BY round")
    .all(p.id)
    .map((r) => {
      const round = plain(r);
      round.prompts = promptsOf(db, round.id);
      delete round.id;
      return round;
    });
  return p;
}

function promptsOf(db, roundId) {
  return db
    .prepare("SELECT tag, prompt, selector, text, html, target FROM review_prompts WHERE round_id = ? ORDER BY seq")
    .all(roundId)
    .map((r) => ({ ...plain(r), target: r.target ? JSON.parse(r.target) : null }));
}

// Register a plan file (or refresh its path, title and hash). Slug defaults
// to the file's basename.
export function upsert(db, { file, slug, title, feature, root = process.cwd() } = {}) {
  if (typeof file !== "string" || !file)
    throw new BrainError("INVALID_ARG", "file is required — the plan HTML", ["brain review open plans/<plan>.html"]);
  const abs = path.resolve(root, file);
  if (!fs.existsSync(abs))
    throw new BrainError("NOT_FOUND", `plan file ${file} does not exist`, ["Write the plan HTML first, then register it"]);
  slug = slug || slugFromFile(abs);
  if (!NAME_RE.test(slug))
    throw new BrainError("INVALID_NAME", `invalid plan slug "${slug}"`, ["Use letters, digits, \".\", \"_\" and \"-\""]);
  const rel = relToRoot(root, abs);
  const sha = sha256File(abs);
  const t = title || titleFromHtml(abs) || slug;
  return tx(db, () => {
    const fid = feature ? lookupFeature(db, feature).id : null;
    const at = now();
    const existing = db.prepare("SELECT id, feature_id, sha256, status FROM plans WHERE slug = ?").get(slug);
    if (existing) {
      db.prepare("UPDATE plans SET title = ?, file_path = ?, sha256 = ?, feature_id = ?, updated = ? WHERE id = ?").run(
        t, rel, sha, fid ?? existing.feature_id, at, existing.id
      );
      // An approval covers the exact contents that were approved: an edited
      // file goes back to review instead of inheriting the old approval.
      if (existing.status === "approved" && existing.sha256 !== sha)
        db.prepare("UPDATE plans SET status = 'in-review', approved_by = NULL WHERE id = ?").run(existing.id);
    } else
      db.prepare(
        "INSERT INTO plans (slug, title, file_path, sha256, feature_id, status, rounds, created, updated) VALUES (?, ?, ?, ?, ?, 'draft', 0, ?, ?)"
      ).run(slug, t, rel, sha, fid, at, at);
    return { ...lookup(db, slug), created: !existing };
  });
}

// Mark a review session open (the server is serving this plan on `port`).
export function startSession(db, slug, { port = null } = {}) {
  return tx(db, () => {
    const p = lookup(db, slug);
    const at = now();
    db.prepare("UPDATE plans SET session_open = 1, session_port = ?, session_started = ?, updated = ? WHERE id = ?").run(port, at, at, p.id);
    return lookup(db, slug);
  });
}

// Plans with an open review session, newest first.
export function openSessions(db) {
  return db.prepare(`${SELECT} WHERE p.session_open = 1 ORDER BY p.session_started DESC, p.id DESC`).all().map(shape);
}

function insertPrompts(db, roundId, prompts, startSeq) {
  const ins = db.prepare(
    "INSERT INTO review_prompts (round_id, seq, tag, prompt, selector, text, html, target) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  prompts.forEach((pr, i) => {
    if (!pr || typeof pr.prompt !== "string")
      throw new BrainError("INVALID_ARG", `prompt ${i + 1} has no prompt text`, ["Each prompt needs { prompt: \"...\" }"]);
    ins.run(roundId, startSeq + i, pr.tag ?? null, pr.prompt, pr.selector ?? null, pr.text ?? null, pr.html ?? null,
      pr.target === undefined || pr.target === null ? null : JSON.stringify(pr.target));
  });
}

// Record review round N+1 with its prompts and optional snapshot file.
// Status: draft → in-review; a round with `endedBy` makes it reviewed.
export function addRound(db, slug, { prompts = [], endedBy = null, snapshotPath = null, root = process.cwd() } = {}) {
  let snap = null;
  if (snapshotPath) {
    const abs = path.resolve(root, snapshotPath);
    if (!fs.existsSync(abs)) throw new BrainError("NOT_FOUND", `snapshot ${snapshotPath} does not exist`, ["Write the snapshot first"]);
    snap = { path: relToRoot(root, abs), sha: sha256File(abs) };
  }
  return tx(db, () => {
    const p = lookup(db, slug);
    const round = p.rounds + 1;
    const at = now();
    const { lastInsertRowid } = db
      .prepare("INSERT INTO review_rounds (plan_id, round, at, ended_by, snapshot_path, snapshot_sha256) VALUES (?, ?, ?, ?, ?, ?)")
      .run(p.id, round, at, endedBy, snap ? snap.path : null, snap ? snap.sha : null);
    insertPrompts(db, lastInsertRowid, prompts, 1);
    const status = p.status === "approved" ? "approved" : endedBy ? "reviewed" : p.status === "draft" ? "in-review" : p.status;
    db.prepare("UPDATE plans SET rounds = ?, status = ?, updated = ? WHERE id = ?").run(round, status, at, p.id);
    return { slug: p.slug, round, status };
  });
}

// Append prompts to a round (default: the latest).
export function addPrompts(db, slug, prompts, { round } = {}) {
  return tx(db, () => {
    const p = lookup(db, slug);
    const r = round ?? p.rounds;
    const row = db.prepare("SELECT id FROM review_rounds WHERE plan_id = ? AND round = ?").get(p.id, r);
    if (!row)
      throw new BrainError("NOT_FOUND", `plan ${p.slug} has no round ${r}`, [`brain plans view ${p.slug}`]);
    const start = db.prepare("SELECT coalesce(max(seq), 0) + 1 AS s FROM review_prompts WHERE round_id = ?").get(row.id).s;
    insertPrompts(db, row.id, prompts, start);
    return { slug: p.slug, round: r, added: prompts.length };
  });
}

// Close the session. `approvedBy` approves without the browser (headless/CI,
// #8): it records a new round ended by the approver and sets status approved.
export function endSession(db, slug, { approvedBy } = {}) {
  if (approvedBy !== undefined && (typeof approvedBy !== "string" || !approvedBy.trim()))
    throw new BrainError("INVALID_ARG", "approvedBy must name who approved", [`brain review end ${slug} --approved-by <who>`]);
  return tx(db, () => {
    const p = lookup(db, slug);
    const at = now();
    let round = null;
    if (approvedBy) {
      round = addRound(db, slug, { endedBy: approvedBy.trim() }).round;
      db.prepare("UPDATE plans SET status = 'approved', approved_by = ? WHERE id = ?").run(approvedBy.trim(), p.id);
    }
    db.prepare("UPDATE plans SET session_open = 0, session_port = NULL, updated = ? WHERE id = ?").run(at, p.id);
    return { ...lookup(db, slug), approved_round: round };
  });
}
