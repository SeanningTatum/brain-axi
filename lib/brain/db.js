// lib/brain/db.js — the only place that opens the database.
// open (WAL, busy_timeout, foreign keys) · locate (worktree → main checkout)
// · migrate (PRAGMA user_version, .bak copy, one transaction) · check · close.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BrainError } from "./errors.js";
import { sha256File } from "./util.js";

export const DB_FILE = "brain.db";
export const BUSY_TIMEOUT_MS = 5000;
const MIGRATIONS_DIR = new URL("./migrations/", import.meta.url);

// ---------------------------------------------------------------------------
// Locating the brain
// ---------------------------------------------------------------------------

// Walk up from `start` to the nearest `.git` (dir or worktree file). Returns
// { toplevel, mainRoot } where mainRoot is the main checkout every worktree
// shares, or null outside git. Reads git's files directly — no git binary.
export function gitRoots(start) {
  let dir = fs.realpathSync(path.resolve(start));
  for (;;) {
    const dotgit = path.join(dir, ".git");
    let st = null;
    try {
      st = fs.statSync(dotgit);
    } catch {
      // keep walking
    }
    if (st) {
      let common = dotgit;
      if (st.isFile()) {
        const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotgit, "utf8"));
        if (!m) return { toplevel: dir, mainRoot: dir };
        const gitdir = path.resolve(dir, m[1].trim());
        const cf = path.join(gitdir, "commondir");
        common = fs.existsSync(cf) ? path.resolve(gitdir, fs.readFileSync(cf, "utf8").trim()) : gitdir;
      }
      // A submodule's common dir is .git/modules/<name>: its own checkout is main.
      const mainRoot = path.basename(common) === ".git" ? path.dirname(common) : dir;
      return { toplevel: dir, mainRoot: fs.realpathSync(mainRoot) };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function findUp(start, stop, name) {
  let dir = path.resolve(start);
  for (;;) {
    const p = path.join(dir, name);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
    if (dir === stop) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Resolve where the brain lives. In a git worktree the `.brain/` of the main
// checkout is used, so every worktree shares one brain.db.
// Returns { root, mainRoot, brainDir, dbPath, worktree } — root is the
// checkout the caller stands in (for git stamping), brainDir may not exist yet.
// The deepest existing directory at or above `p`.
function existingAncestor(p) {
  let dir = p;
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  return dir;
}

// realpath for a path that may not exist yet (`init --brain state/.brain`):
// resolve the deepest existing ancestor, keep the rest as given.
function realpathLoose(p) {
  const have = existingAncestor(p);
  return path.join(fs.realpathSync(have), path.relative(have, p));
}

export function locate(start = process.cwd(), { brain } = {}) {
  start = realpathLoose(path.resolve(start));
  const explicit = brain ? realpathLoose(path.resolve(start, brain)) : null;
  const g = gitRoots(existingAncestor(explicit ? path.dirname(explicit) : start));
  // An explicit brain of the caller's own repo (its main checkout's, from a
  // worktree) still stamps the checkout the caller stands in.
  const here = explicit && g ? gitRoots(existingAncestor(start)) : g;
  const toplevel = here && g && here.mainRoot === g.mainRoot ? here.toplevel : g && g.toplevel;
  let brainDir;
  if (g) {
    const rel = (p) => path.relative(g.toplevel, p);
    const local = explicit || findUp(start, g.toplevel, ".brain") || path.join(g.toplevel, ".brain");
    // Always the main checkout's — never a worktree-local fallback, which
    // would split records into a DB hidden once the main .brain/ appears.
    brainDir = path.join(g.mainRoot, rel(local));
  } else {
    brainDir = explicit || findUp(start, path.parse(start).root, ".brain") || path.join(start, ".brain");
  }
  return {
    root: g ? toplevel : path.dirname(brainDir),
    mainRoot: g ? g.mainRoot : path.dirname(brainDir),
    brainDir,
    dbPath: path.join(brainDir, DB_FILE),
    worktree: !!g && g.mainRoot !== toplevel,
  };
}

// A markdown-era brain: files the old CLI wrote, and no brain.db.
export function isLegacyBrain(brainDir) {
  if (fs.existsSync(path.join(brainDir, DB_FILE))) return false;
  return (
    fs.existsSync(path.join(brainDir, "features", "feature_list.json")) ||
    fs.existsSync(path.join(brainDir, "runs", "progress.md"))
  );
}

const legacyError = (brainDir) =>
  new BrainError("LEGACY_BRAIN", `${brainDir} is a markdown brain (no brain.db) — this brain-axi reads SQLite only`, [
    "Pin the old CLI for this repo: npx -y brain-axi@0.2.0 <command>",
    "Or move the old .brain/ aside, then run `brain init`",
  ]);

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

// [{ version, name, sql }] sorted, from NNN-*.sql files.
export function loadMigrations(dir = MIGRATIONS_DIR) {
  const d = dir instanceof URL ? dir : path.resolve(dir);
  return fs
    .readdirSync(d)
    .map((f) => ({ f, m: /^(\d{3})-.+\.sql$/.exec(f) }))
    .filter((x) => x.m)
    .map(({ f, m }) => ({
      version: Number(m[1]),
      name: f,
      sql: fs.readFileSync(dir instanceof URL ? new URL(f, dir) : path.join(d, f), "utf8"),
    }))
    .sort((a, b) => a.version - b.version);
}

export const schemaVersion = (db) => db.prepare("PRAGMA user_version").get().user_version;

// Bring `db` up to the newest migration. A DB newer than this library is
// refused before any write. An existing DB is first copied to
// brain.db.bak-v<current>, then every pending migration runs in ONE
// transaction — a failure rolls back and leaves the copy untouched.
export function migrate(db, { dbPath, migrations = loadMigrations(), backup = true } = {}) {
  const current = schemaVersion(db);
  const latest = migrations.length ? migrations[migrations.length - 1].version : 0;
  const tooNew = (v) =>
    new BrainError("DB_TOO_NEW", `brain.db is schema v${v}; this brain-axi knows up to v${latest}`, [
      "upgrade brain-axi: npx -y brain-axi@latest <command>",
    ]);
  if (current > latest) throw tooNew(current);
  if (!migrations.some((m) => m.version > current)) return { from: current, to: current, backup: null };

  // VACUUM INTO cannot run inside a transaction, so the copy goes to a
  // private temp file first and is renamed into place only once the write
  // lock confirms this process is the one migrating from `current`.
  let bak = null;
  let tmp = null;
  if (backup && dbPath && dbPath !== ":memory:") {
    tmp = `${dbPath}.bak-v${current}.tmp-${process.pid}-${Date.now()}`; // matches the brain.db.bak-v* gitignore
    fs.rmSync(tmp, { force: true });
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  }
  const dropTmp = () => tmp && fs.rmSync(tmp, { force: true });
  let running = null;
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch (e) {
    dropTmp();
    throw e;
  }
  // Another process may have migrated between the read above and taking the
  // write lock: re-read under the lock, and if it moved, drop this copy (it
  // may already hold the upgraded DB) and start over from the new version —
  // no migration runs twice and another process's backup is never replaced.
  if (schemaVersion(db) !== current) {
    db.exec("ROLLBACK");
    dropTmp();
    return migrate(db, { dbPath, migrations, backup });
  }
  const pending = migrations.filter((m) => m.version > current);
  if (tmp) {
    bak = `${dbPath}.bak-v${current}`;
    try {
      fs.renameSync(tmp, bak);
    } catch (e) {
      db.exec("ROLLBACK");
      dropTmp();
      throw e;
    }
  }
  try {
    for (const m of pending) {
      running = m;
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
    }
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // already rolled back by SQLite
    }
    throw new BrainError(
      "MIGRATION_FAILED",
      `migration ${running.name} failed: ${e.message} — rolled back, brain.db is still v${current}`,
      bak ? [`The pre-migration copy is ${bak}; restore it with: cp '${bak}' '${dbPath}'`] : ["Nothing was written"]
    );
  }
  return { from: current, to: latest, backup: bak };
}

// ---------------------------------------------------------------------------
// Open / create / close
// ---------------------------------------------------------------------------

function configure(db) {
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

// Open an existing brain.db (or ":memory:"), migrated to the latest schema.
export function open(dbPath, { migrations } = {}) {
  if (dbPath !== ":memory:" && !fs.existsSync(dbPath)) throw noDb(path.dirname(dbPath));
  const db = configure(new DatabaseSync(dbPath));
  try {
    migrate(db, { dbPath, migrations });
  } catch (e) {
    db.close();
    throw e;
  }
  return db;
}

const noDb = (brainDir) =>
  new BrainError("NO_DB", `no brain.db at ${brainDir}`, [
    "Run `brain init` to create one in this repo",
    "Or run `brain import <file>` to restore an export",
  ]);

// Create `<root>/.brain/brain.db` fresh (or `<brain>/brain.db` for an
// explicit brain directory). Refuses over an existing DB or a markdown-era
// brain. `gitignore` adds the DB, its WAL files, backups, export.toon and
// shots to the repo's .gitignore.
export function create(root, { brain, gitignore = true, migrations } = {}) {
  const loc = locate(root, { brain: brain ? path.resolve(root, brain) : path.join(path.resolve(root), ".brain") });
  if (fs.existsSync(loc.dbPath))
    throw new BrainError("BRAIN_EXISTS", `${loc.dbPath} already exists`, ["Run `brain` to see its state"]);
  if (isLegacyBrain(loc.brainDir)) throw legacyError(loc.brainDir);
  fs.mkdirSync(loc.brainDir, { recursive: true });
  // Reserve the path exclusively: a concurrent create gets BRAIN_EXISTS, and
  // the cleanup below can only ever remove the file this call made.
  try {
    fs.closeSync(fs.openSync(loc.dbPath, "wx"));
  } catch (e) {
    if (e.code === "EEXIST")
      throw new BrainError("BRAIN_EXISTS", `${loc.dbPath} already exists`, ["Run `brain` to see its state"]);
    throw e;
  }
  const db = configure(new DatabaseSync(loc.dbPath));
  try {
    migrate(db, { dbPath: loc.dbPath, migrations, backup: false });
  } catch (e) {
    db.close();
    fs.rmSync(loc.dbPath, { force: true });
    throw e;
  }
  if (gitignore) ensureGitignore(loc.mainRoot, loc.brainDir);
  return { ...loc, db };
}

export const GITIGNORE_ENTRIES = ["brain.db", "brain.db-wal", "brain.db-shm", "brain.db.bak-v*", "export.toon", "shots/"];

export function ensureGitignore(root, brainDir) {
  const prefix = path.relative(root, brainDir).split(path.sep).join("/");
  const file = path.join(root, ".gitignore");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const have = new Set(text.split("\n").map((l) => l.trim()));
  const add = GITIGNORE_ENTRIES.map((e) => `${prefix}/${e}`).filter((e) => !have.has(e));
  if (!add.length) return [];
  const sep = text && !text.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(file, `${text}${sep}${text ? "\n" : ""}# brain-axi local state\n${add.join("\n")}\n`);
  return add;
}

// Locate + open, with the error paths the CLI needs: LEGACY_BRAIN for a
// markdown brain, NO_DB when nothing is there.
export function openBrain(start = process.cwd(), { brain, migrations } = {}) {
  const loc = locate(start, { brain });
  if (!fs.existsSync(loc.dbPath)) {
    if (isLegacyBrain(loc.brainDir)) throw legacyError(loc.brainDir);
    throw noDb(loc.brainDir);
  }
  return { ...loc, db: open(loc.dbPath, { migrations }) };
}

export function close(db) {
  try {
    db.close();
  } catch {
    // already closed
  }
}

// ---------------------------------------------------------------------------
// check — integrity plus the cross-entity rules a CHECK cannot express
// ---------------------------------------------------------------------------

// [{ check, status: pass|fail, detail }]. `root` (the caller's checkout)
// resolves plan files, which are tracked in git; `mainRoot` (the main checkout
// holding the shared brain) resolves shots, which live in its gitignored
// .brain/shots/ whichever worktree recorded them.
export function check(db, { root = process.cwd(), mainRoot = root } = {}) {
  const rows = [];
  const add = (checkName, failures, okDetail) =>
    rows.push(
      failures.length
        ? { check: checkName, status: "fail", detail: failures.join("; ") }
        : { check: checkName, status: "pass", detail: okDetail }
    );

  // A long-lived connection (the review server) caches FTS5's index structure;
  // after another connection writes, integrity_check reads the stale copy and
  // reports a false "fts5: checksum mismatch". Touching the table first, in
  // the same read transaction, refreshes it.
  const own = !db.isTransaction;
  if (own) db.exec("BEGIN");
  let integ;
  try {
    db.prepare("SELECT count(*) FROM search").get();
    integ = db.prepare("PRAGMA integrity_check").all().map((r) => r.integrity_check);
  } finally {
    if (own) db.exec("COMMIT");
  }
  add("sqlite integrity", integ.filter((x) => x !== "ok"), "ok");

  const fk = db.prepare("PRAGMA foreign_key_check").all();
  add("foreign keys", fk.map((r) => `${r.table} row ${r.rowid} → ${r.parent}`), "ok");

  let fts = [];
  try {
    db.exec("INSERT INTO search (search) VALUES ('integrity-check')");
  } catch (e) {
    fts = [e.message];
  }
  add("search index", fts, "in sync");

  const unverified = db
    .prepare(
      `SELECT f.slug FROM features f
       WHERE f.status = 'shipped' AND f.grandfathered = 0
         AND coalesce((SELECT verdict FROM verifications v WHERE v.feature_id = f.id
                       ORDER BY round DESC LIMIT 1), '') <> 'PASS'
       ORDER BY f.slug`
    )
    .all()
    .map((r) => `${r.slug} has no PASS verification — brain verifications add ${r.slug} --verdict PASS`);
  add("shipped features verified", unverified, "every shipped feature has a PASS (or is grandfathered)");

  const openTasks = db
    .prepare(
      `SELECT f.slug, t.key FROM tasks t JOIN features f ON f.id = t.feature_id
       WHERE f.status = 'shipped' AND t.status IN ('open', 'claimed', 'blocked') ORDER BY f.slug, t.id`
    )
    .all()
    .map((r) => `${r.slug} is shipped but task ${r.key} is still open — brain tasks set ${r.slug} ${r.key} --status done|cut`);
  add("shipped features have no open tasks", openTasks, "ok");

  const files = [];
  const hashOk = (rel, sha, label, fix, base = root) => {
    const abs = path.resolve(base, rel);
    if (!fs.existsSync(abs)) files.push(`${label} ${rel} is missing — ${fix}`);
    else if (sha && sha256File(abs) !== sha) files.push(`${label} ${rel} changed since it was recorded — ${fix}`);
  };
  for (const p of db.prepare("SELECT slug, file_path, sha256 FROM plans ORDER BY id").all())
    hashOk(p.file_path, p.sha256, "plan", `brain review open ${p.file_path} to re-register it`);
  for (const r of db.prepare("SELECT snapshot_path, snapshot_sha256 FROM review_rounds WHERE snapshot_path IS NOT NULL ORDER BY id").all())
    hashOk(r.snapshot_path, r.snapshot_sha256, "plan snapshot", "restore it from git");
  const shotRef = (rel) => (path.resolve(root) === path.resolve(mainRoot) ? rel : path.join(mainRoot, rel));
  for (const s of db
    .prepare(
      `SELECT s.path, s.sha256, f.slug FROM shots s JOIN verifications v ON v.id = s.verification_id
       JOIN features f ON f.id = v.feature_id ORDER BY s.id`
    )
    .all())
    hashOk(s.path, s.sha256, "shot", `re-add it: brain verifications add ${s.slug} --shot ${shotRef(s.path)} ...`, mainRoot);
  add("plan and shot files", files, "every recorded file exists and matches its hash");

  return rows;
}
