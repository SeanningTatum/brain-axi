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

// sha256 of `abs`, or null when it cannot be read — cached on (size, mtime):
// check (every dashboard refresh), pin `superseded` and shot health re-hash
// the same rarely-changing shots and plans over and over.
const shaCache = new Map(); // abs -> { size, mtimeMs, sha }
const SHA_CACHE_MAX = 2000;
export function sha256FileCached(abs) {
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    shaCache.delete(abs);
    return null;
  }
  const hit = shaCache.get(abs);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.sha;
  let sha;
  try {
    sha = sha256File(abs);
  } catch {
    return null;
  }
  if (shaCache.size >= SHA_CACHE_MAX) shaCache.delete(shaCache.keys().next().value);
  shaCache.set(abs, { size: st.size, mtimeMs: st.mtimeMs, sha });
  return sha;
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

// The full SHA-1 (40 chars; a SHA-256 repo's id is cut to 40, which the
// commit_sha CHECK allows): a bare `--short` follows core.abbrev, which can
// go below the CHECK's 7-char minimum. Displays may abbreviate.
export const gitHead = (root) => git(root, ["rev-parse", "--short=40", "HEAD"]);
// Branch name (works on an unborn branch too), "detached", or null without git.
export const gitBranch = (root) =>
  git(root, ["symbolic-ref", "--short", "-q", "HEAD"]) || (gitHead(root) ? "detached" : null);
export const gitDirty = (root) => {
  const s = git(root, ["status", "--porcelain"]);
  return s === null ? null : s.length > 0;
};
export const gitAuthor = (root) => git(root, ["log", "-1", "--format=%an"]);
// Is `commit` an ancestor of (or equal to) HEAD in `root`? true / false, or
// null when unknown (no git, no HEAD, or the commit is not in this checkout).
export const gitIsAncestor = (root, commit) => {
  if (!commit || !/^[0-9a-f]{4,64}$/i.test(commit)) return null;
  const r = spawnSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: root, encoding: "utf8" });
  return r.status === 0 ? true : r.status === 1 ? false : null;
};
