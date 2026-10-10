// lib/brain/util.js — small shared helpers: transactions, text clipping,
// hashing, git probes, validation patterns.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BrainError, fromSqlite } from "./errors.js";

export const SUMMARY_MAX_CHARS = 200;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Doc names, run names, check names: a path-safe token (no slashes).
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const now = () => new Date().toISOString();
export const today = () => now().slice(0, 10);

// Plain object copy of a node:sqlite row (rows have a null prototype).
export const plain = (row) => (row ? { ...row } : null);

// Clip to at most `max` characters (code points, never mid-surrogate) and end
// with "…" when anything was cut. The ellipsis counts toward `max`.
export function clipChars(text, max) {
  const chars = Array.from(String(text));
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, Math.max(0, max - 1)).join("").trimEnd() + "…";
}

export const charLength = (s) => Array.from(String(s)).length;

export function requireText(value, field, help = []) {
  if (typeof value !== "string" || !value.trim())
    throw new BrainError("INVALID_ARG", `${field} is required and must be non-empty`, help);
  return value;
}

// Writes run in one transaction: BEGIN IMMEDIATE takes the write lock up
// front (so a read-then-write cannot race another process), nested calls
// become savepoints. Constraint errors surface as BrainErrors.
const depth = new WeakMap();
export function tx(db, fn) {
  const d = depth.get(db) || 0;
  const sp = `sp${d}`;
  db.exec(d === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`);
  depth.set(db, d + 1);
  try {
    const out = fn();
    db.exec(d === 0 ? "COMMIT" : `RELEASE ${sp}`);
    return out;
  } catch (e) {
    try {
      db.exec(d === 0 ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    } catch {
      // the transaction is already gone; the original error matters more
    }
    throw fromSqlite(e);
  } finally {
    depth.set(db, d);
  }
}

export function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// Repo-relative POSIX path when inside root, else the absolute path.
export function relToRoot(root, file) {
  const abs = path.resolve(root, file);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return abs;
  return rel.split(path.sep).join("/");
}

function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

export const gitHead = (root) => git(root, ["rev-parse", "--short", "HEAD"]);
// Branch name (works on an unborn branch too), "detached", or null without git.
export const gitBranch = (root) =>
  git(root, ["symbolic-ref", "--short", "-q", "HEAD"]) || (gitHead(root) ? "detached" : null);
export const gitDirty = (root) => {
  const s = git(root, ["status", "--porcelain"]);
  return s === null ? null : s.length > 0;
};
export const gitAuthor = (root) => git(root, ["log", "-1", "--format=%an"]);
