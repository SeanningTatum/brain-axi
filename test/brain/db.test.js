import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  openBrain, open, create, close, locate, loadMigrations, schemaVersion, isLegacyBrain, check,
  features, plans, verifications,
} from "../../lib/brain/index.js";
import { ensureGitignore } from "../../lib/brain/db.js";
import { tmpDir, git, gitRepo, freshBrain, throwsCode } from "./helpers.js";

const LATEST = loadMigrations().at(-1).version;

test("create makes .brain/brain.db at the latest schema with WAL, busy_timeout and foreign keys", (t) => {
  const b = freshBrain(t);
  assert.equal(b.dbPath, path.join(b.root, ".brain", "brain.db"));
  assert.ok(fs.existsSync(b.dbPath));
  assert.equal(schemaVersion(b.db), LATEST);
  assert.equal(b.db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  assert.equal(b.db.prepare("PRAGMA busy_timeout").get().timeout, 5000);
  assert.equal(b.db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  assert.ok(!fs.readdirSync(path.dirname(b.dbPath)).some((f) => f.includes(".bak-")), "a brand-new DB needs no backup");
});

test("create refuses an existing brain.db (BRAIN_EXISTS) and a markdown brain (LEGACY_BRAIN)", (t) => {
  const b = freshBrain(t);
  throwsCode(() => create(b.root), "BRAIN_EXISTS");
  const legacy = tmpDir(t);
  fs.mkdirSync(path.join(legacy, ".brain", "runs"), { recursive: true });
  fs.writeFileSync(path.join(legacy, ".brain", "runs", "progress.md"), "# Progress\n");
  throwsCode(() => create(legacy), "LEGACY_BRAIN");
  assert.ok(!fs.existsSync(path.join(legacy, ".brain", "brain.db")), "init must not write over a legacy brain");
});

test("openBrain: NO_DB with init/import help, LEGACY_BRAIN for a markdown brain", (t) => {
  const empty = tmpDir(t);
  const e = throwsCode(() => openBrain(empty), "NO_DB");
  assert.ok(e.help.some((h) => /brain init/.test(h)) && e.help.some((h) => /brain import/.test(h)));
  assert.equal(e.exitCode, 1);

  const legacy = tmpDir(t);
  fs.mkdirSync(path.join(legacy, ".brain", "features"), { recursive: true });
  fs.writeFileSync(path.join(legacy, ".brain", "features", "feature_list.json"), "{}");
  assert.equal(isLegacyBrain(path.join(legacy, ".brain")), true);
  const l = throwsCode(() => openBrain(legacy), "LEGACY_BRAIN");
  assert.ok(l.help.some((h) => /brain-axi@0\.2\.0/.test(h)));
  assert.equal(isLegacyBrain(path.join(empty, ".brain")), false);
});

test("openBrain finds the brain walking up from a subdirectory and via an explicit path", (t) => {
  const b = freshBrain(t);
  const sub = path.join(b.root, "a", "b");
  fs.mkdirSync(sub, { recursive: true });
  const o = openBrain(sub);
  t.after(() => close(o.db));
  assert.equal(o.dbPath, b.dbPath);
  const e = openBrain(tmpDir(t), { brain: path.join(b.root, ".brain") });
  t.after(() => close(e.db));
  assert.equal(e.dbPath, b.dbPath);
});

test("worktrees share the main checkout's brain.db through the git common dir", (t) => {
  const base = tmpDir(t);
  const main = path.join(base, "main");
  fs.mkdirSync(main);
  gitRepo(main);
  const b = create(main);
  t.after(() => close(b.db));
  features.add(b.db, { slug: "shared", name: "Shared" });

  const wt = path.join(base, "wt");
  git(main, "worktree", "add", "-q", wt, "-b", "wt-branch");
  const sub = path.join(wt, "deep", "dir");
  fs.mkdirSync(sub, { recursive: true });

  const loc = locate(sub);
  assert.equal(loc.dbPath, b.dbPath);
  assert.equal(loc.worktree, true);
  assert.equal(loc.root, wt);
  assert.equal(loc.mainRoot, main);

  const w = openBrain(sub);
  t.after(() => close(w.db));
  assert.equal(features.get(w.db, "shared").name, "Shared");
  features.add(w.db, { slug: "from-worktree", name: "From worktree" });
  assert.equal(features.list(b.db).length, 2);
  assert.equal(locate(main).worktree, false);
});

test("create in a git repo gitignores the DB, WAL files, backups, export and shots (idempotent)", (t) => {
  const b = freshBrain(t, { withGit: true });
  const gi = fs.readFileSync(path.join(b.root, ".gitignore"), "utf8");
  for (const e of [".brain/brain.db", ".brain/brain.db-wal", ".brain/brain.db-shm", ".brain/brain.db.bak-v*", ".brain/export.toon", ".brain/shots/"])
    assert.ok(gi.split("\n").includes(e), `missing ${e}`);
  assert.deepEqual(ensureGitignore(b.root, path.join(b.root, ".brain")), []);
  assert.equal(git(b.root, "status", "--porcelain", "--", ".brain"), "");
});

test("migrate: an existing v0 DB is copied to brain.db.bak-v0, then brought to latest", (t) => {
  const dir = tmpDir(t);
  const dbPath = path.join(dir, "brain.db");
  const raw = new DatabaseSync(dbPath);
  raw.exec("CREATE TABLE legacy_marker (x TEXT); INSERT INTO legacy_marker VALUES ('kept');");
  raw.close();
  const db = open(dbPath);
  t.after(() => close(db));
  assert.equal(schemaVersion(db), LATEST);
  const bak = `${dbPath}.bak-v0`;
  assert.ok(fs.existsSync(bak));
  const copy = new DatabaseSync(bak);
  assert.equal(copy.prepare("PRAGMA user_version").get().user_version, 0);
  assert.equal(copy.prepare("SELECT x FROM legacy_marker").get().x, "kept");
  copy.close();
});

function migrationsWith(t, extraSql) {
  const dir = tmpDir(t, "brain-mig-");
  for (const m of loadMigrations()) fs.writeFileSync(path.join(dir, m.name), m.sql);
  fs.writeFileSync(path.join(dir, `${String(LATEST + 1).padStart(3, "0")}-next.sql`), extraSql);
  return loadMigrations(dir);
}

test("migrate: a newer migration runs in one transaction after a .bak-vN copy; data survives", (t) => {
  const b = freshBrain(t);
  features.add(b.db, { slug: "keep-me", name: "Keep me" });
  close(b.db);
  const migs = migrationsWith(t, "CREATE TABLE extra (x TEXT);\nALTER TABLE features ADD COLUMN extra_note TEXT;\n");
  const db = open(b.dbPath, { migrations: migs });
  t.after(() => close(db));
  assert.equal(schemaVersion(db), LATEST + 1);
  assert.equal(features.get(db, "keep-me").extra_note, null);
  assert.ok(fs.existsSync(`${b.dbPath}.bak-v${LATEST}`));
});

test("migrate: a failing migration rolls back everything and leaves the .bak untouched", (t) => {
  const b = freshBrain(t);
  features.add(b.db, { slug: "before", name: "Before" });
  close(b.db);
  const migs = migrationsWith(t, "CREATE TABLE half_done (x TEXT);\nINSERT INTO no_such_table VALUES (1);\n");
  const e = throwsCode(() => open(b.dbPath, { migrations: migs }), "MIGRATION_FAILED", /\d{3}-next\.sql/);
  const bak = `${b.dbPath}.bak-v${LATEST}`;
  assert.ok(e.help.some((h) => h.includes(bak)), "help names the restore copy");
  const raw = new DatabaseSync(b.dbPath);
  assert.equal(raw.prepare("PRAGMA user_version").get().user_version, LATEST);
  assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name = 'half_done'").get(), undefined);
  raw.close();
  const copy = new DatabaseSync(bak);
  assert.equal(copy.prepare("SELECT slug FROM features").get().slug, "before");
  copy.close();
});

test("a DB newer than the library is refused with no writes and no backup", (t) => {
  const b = freshBrain(t);
  b.db.exec("PRAGMA user_version = 99");
  close(b.db);
  const before = fs.readFileSync(b.dbPath);
  const e = throwsCode(() => open(b.dbPath), "DB_TOO_NEW");
  assert.ok(e.help.some((h) => /upgrade brain-axi/.test(h)));
  assert.ok(!fs.readdirSync(path.dirname(b.dbPath)).some((f) => f.includes(".bak-")));
  assert.deepEqual(fs.readFileSync(b.dbPath), before);
});

test("check: passes on a clean brain and flags unverified shipped features, open tasks on shipped, changed files", (t) => {
  const b = freshBrain(t);
  const fail = () => check(b.db, { root: b.root }).filter((r) => r.status === "fail").map((r) => r.check);
  assert.deepEqual(fail(), []);

  const at = new Date().toISOString();
  b.db.prepare("INSERT INTO features (slug, name, status, evidence, created, updated) VALUES ('rogue', 'Rogue', 'shipped', 'e', ?, ?)").run(at, at);
  b.db.prepare("INSERT INTO tasks (feature_id, key, title, acceptance, created, updated) VALUES (1, 't1', 'x', 'y', ?, ?)").run(at, at);
  assert.deepEqual(fail(), ["shipped features verified", "shipped features have no open tasks"]);

  const planFile = path.join(b.root, "plan.html");
  fs.writeFileSync(planFile, "<title>P</title>v1");
  plans.upsert(b.db, { file: "plan.html", root: b.root });
  features.add(b.db, { slug: "shot-feat", name: "Shot" });
  fs.writeFileSync(path.join(b.root, "s.png"), "png");
  verifications.add(b.db, "shot-feat", { verdict: "PASS", body: "ok", shots: ["s.png"], root: b.root });
  fs.writeFileSync(planFile, "<title>P</title>v2");
  fs.rmSync(path.join(b.root, "s.png"));
  const files = check(b.db, { root: b.root }).find((r) => r.check === "plan and shot files");
  assert.equal(files.status, "fail");
  assert.match(files.detail, /plan plan\.html changed/);
  assert.match(files.detail, /shot s\.png is missing/);
});
