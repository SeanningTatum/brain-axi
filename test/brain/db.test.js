import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  openBrain, open, create, close, locate, migrate, loadMigrations, schemaVersion, isLegacyBrain, check,
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

test("migrate: a process that read the old version just before another migrated keeps that one's backup", (t) => {
  const dir = tmpDir(t);
  const dbPath = path.join(dir, "brain.db");
  const raw = new DatabaseSync(dbPath);
  raw.exec("CREATE TABLE legacy_marker (x TEXT); INSERT INTO legacy_marker VALUES ('kept');");
  raw.close();
  const slow = new DatabaseSync(dbPath);
  t.after(() => close(slow));
  // `slow` reads user_version 0, then another process migrates the file
  // (backing up v0) before `slow` makes its own copy and takes the lock.
  let raced = false;
  const view = {
    exec: (sql) => slow.exec(sql),
    prepare: (sql) => {
      const st = slow.prepare(sql);
      if (raced || !/user_version/.test(sql)) return st;
      return {
        get: () => {
          const r = st.get();
          raced = true;
          close(open(dbPath));
          return r;
        },
      };
    },
  };
  const r = migrate(view, { dbPath });
  assert.equal(r.from, LATEST, "restarted from the version the other process left");
  assert.equal(r.backup, null);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes(".bak-")), ["brain.db.bak-v0"], "no stray temp copy");
  const copy = new DatabaseSync(`${dbPath}.bak-v0`);
  assert.equal(copy.prepare("PRAGMA user_version").get().user_version, 0, "the v0 backup still holds v0");
  assert.equal(copy.prepare("SELECT x FROM legacy_marker").get().x, "kept");
  copy.close();
});

test("locate: a worktree-local .brain/ never shadows the main checkout's location", (t) => {
  const base = tmpDir(t);
  const main = path.join(base, "main");
  fs.mkdirSync(main);
  gitRepo(main);
  const wt = path.join(base, "wt");
  git(main, "worktree", "add", "-q", wt, "-b", "wt-branch");
  fs.mkdirSync(path.join(wt, ".brain"));
  assert.equal(locate(wt).brainDir, path.join(fs.realpathSync(main), ".brain"));
  const b = create(wt);
  t.after(() => close(b.db));
  assert.equal(b.dbPath, path.join(fs.realpathSync(main), ".brain", "brain.db"));
  assert.ok(!fs.existsSync(path.join(wt, ".brain", "brain.db")));
});

test("locate: an explicit --brain of the main checkout, from a worktree, keeps the worktree as root", (t) => {
  const base = tmpDir(t);
  const main = path.join(base, "main");
  fs.mkdirSync(main);
  gitRepo(main);
  const wt = path.join(base, "wt");
  git(main, "worktree", "add", "-q", wt, "-b", "wt-branch");
  const loc = locate(wt, { brain: path.join(main, ".brain") });
  assert.equal(loc.brainDir, path.join(fs.realpathSync(main), ".brain"));
  assert.equal(loc.root, fs.realpathSync(wt), "stamps the checkout the caller stands in");
  assert.equal(loc.worktree, true);
  // Another repo's brain still resolves against that repo.
  const other = path.join(base, "other");
  fs.mkdirSync(other);
  gitRepo(other);
  assert.equal(locate(wt, { brain: path.join(other, ".brain") }).root, fs.realpathSync(other));
});

test("create: an explicit brain under directories that do not exist yet is created", (t) => {
  const root = gitRepo(tmpDir(t));
  const b = create(root, { brain: "state/nested/.brain" });
  t.after(() => close(b.db));
  assert.equal(b.brainDir, path.join(root, "state", "nested", ".brain"));
  assert.ok(fs.existsSync(b.dbPath));
  assert.equal(b.root, root);
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
  fs.mkdirSync(path.join(b.root, ".brain", "shots"), { recursive: true });
  fs.writeFileSync(path.join(b.root, ".brain", "shots", "s.png"), "png");
  verifications.add(b.db, "shot-feat", { verdict: "PASS", body: "ok", shots: [".brain/shots/s.png"], root: b.root });
  fs.writeFileSync(planFile, "<title>P</title>v2");
  fs.rmSync(path.join(b.root, ".brain", "shots", "s.png"));
  const files = check(b.db, { root: b.root }).find((r) => r.check === "plan and shot files");
  assert.equal(files.status, "fail");
  assert.match(files.detail, /plan plan\.html changed/);
  assert.match(files.detail, /shot \.brain\/shots\/s\.png is missing/);
});

test("check: a long-lived connection sees no false FTS5 mismatch after another connection writes", (t) => {
  const b = freshBrain(t);
  const other = open(b.dbPath);
  t.after(() => close(other));
  features.add(other, { slug: "a", name: "A" });
  assert.deepEqual(check(b.db, { root: b.root }).filter((r) => r.status !== "pass"), []);
  features.set(other, "a", { name: "A renamed" });
  features.add(other, { slug: "b", name: "B" });
  assert.deepEqual(check(b.db, { root: b.root }).filter((r) => r.status !== "pass"), []);
});

test("migrate re-reads the version under the write lock: a migration another process finished is not re-run", (t) => {
  const b = freshBrain(t);
  close(b.db);
  const real = new DatabaseSync(b.dbPath);
  t.after(() => real.close());
  let stale = true;
  // The first version read predates the other process's commit and says v0.
  const racing = {
    exec: (sql) => real.exec(sql),
    prepare(sql) {
      if (stale && /user_version/.test(sql)) {
        stale = false;
        return { get: () => ({ user_version: 0 }) };
      }
      return real.prepare(sql);
    },
  };
  assert.deepEqual(migrate(racing, { dbPath: b.dbPath, backup: false }), { from: LATEST, to: LATEST, backup: null });
  assert.equal(schemaVersion(real), LATEST);
});

test("concurrent creates: exactly one wins, the rest get BRAIN_EXISTS, and the brain survives", async (t) => {
  const dir = tmpDir(t);
  const lib = new URL("../../lib/brain/index.js", import.meta.url).href;
  const script = `import(${JSON.stringify(lib)}).then((m) => {
    try { m.close(m.create(process.argv[1], { gitignore: false }).db); console.log("ok"); }
    catch (e) { console.log(e.code || e.message); }
  });`;
  const outs = await Promise.all(
    Array.from({ length: 6 }, () =>
      new Promise((resolve) => {
        const p = spawn(process.execPath, ["-e", script, dir], { stdio: ["ignore", "pipe", "inherit"] });
        let out = "";
        p.stdout.on("data", (d) => (out += d));
        p.on("exit", () => resolve(out.trim()));
      })
    )
  );
  assert.equal(outs.filter((o) => o === "ok").length, 1, outs.join(", "));
  assert.deepEqual(outs.filter((o) => o !== "ok"), Array(5).fill("BRAIN_EXISTS"));
  const db = open(path.join(dir, ".brain", "brain.db"));
  t.after(() => close(db));
  assert.equal(schemaVersion(db), LATEST);
});

test("locate: from a worktree subdir, the main checkout's nested .brain wins over its root .brain", (t) => {
  const base = tmpDir(t);
  const main = path.join(base, "main");
  fs.mkdirSync(path.join(main, "packages", "app"), { recursive: true });
  gitRepo(main);
  fs.writeFileSync(path.join(main, "packages", "app", "x.txt"), "x");
  git(main, "add", ".");
  git(main, "commit", "-q", "-m", "app");
  fs.mkdirSync(path.join(main, ".brain"));
  fs.mkdirSync(path.join(main, "packages", "app", ".brain"));
  const wt = path.join(base, "wt");
  git(main, "worktree", "add", "-q", wt, "-b", "wt-branch");
  // The worktree has no .brain/ dirs (gitignored state is never checked out).
  const loc = locate(path.join(wt, "packages", "app"));
  assert.equal(loc.brainDir, path.join(fs.realpathSync(main), "packages", "app", ".brain"));
  assert.equal(loc.root, fs.realpathSync(wt));
  assert.equal(locate(wt).brainDir, path.join(fs.realpathSync(main), ".brain"));
});

test("create: a failed .gitignore write removes the reserved brain.db, so a retry works", (t) => {
  const root = gitRepo(tmpDir(t));
  fs.mkdirSync(path.join(root, ".gitignore")); // writeFileSync -> EISDIR
  assert.throws(() => create(root), /EISDIR/);
  assert.ok(!fs.existsSync(path.join(root, ".brain", "brain.db")), "no half-made brain.db left behind");
  fs.rmdirSync(path.join(root, ".gitignore"));
  const b = create(root);
  t.after(() => close(b.db));
  assert.ok(fs.existsSync(b.dbPath));
});

test("check: a file rewritten after a passing check is still flagged (hash cache keys on size+mtime)", (t) => {
  const b = freshBrain(t);
  const planFile = path.join(b.root, "plan.html");
  fs.writeFileSync(planFile, "<title>P</title>v1");
  plans.upsert(b.db, { file: "plan.html", root: b.root });
  const files = () => check(b.db, { root: b.root }).find((r) => r.check === "plan and shot files");
  assert.equal(files().status, "pass");
  assert.equal(files().status, "pass", "a second (cached) check still passes");
  fs.writeFileSync(planFile, "<title>P</title>v2"); // same size
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(planFile, later, later);
  assert.equal(files().status, "fail");
});

test("locate: a submodule's linked worktree shares the submodule checkout's brain", (t) => {
  const base = tmpDir(t);
  fs.mkdirSync(path.join(base, "lib-src"));
  const lib = gitRepo(path.join(base, "lib-src"));
  const sup = path.join(base, "super");
  fs.mkdirSync(sup);
  gitRepo(sup);
  git(sup, "-c", "protocol.file.allow=always", "submodule", "add", "-q", lib, "sub");
  const sub = path.join(sup, "sub");
  const subWt = path.join(base, "sub-wt");
  git(sub, "worktree", "add", "-q", subWt, "-b", "wt-branch");
  const loc = locate(subWt);
  assert.equal(loc.brainDir, path.join(fs.realpathSync(sub), ".brain"));
  assert.equal(loc.root, fs.realpathSync(subWt));
  assert.equal(loc.worktree, true);
  assert.equal(locate(sub).brainDir, path.join(fs.realpathSync(sub), ".brain"), "the submodule checkout is its own main");
});

test("locate: an explicit --brain outside any repo keeps the caller's checkout as root", (t) => {
  const repo = gitRepo(tmpDir(t));
  const shared = path.join(tmpDir(t), "shared", ".brain");
  const loc = locate(repo, { brain: shared });
  assert.equal(loc.brainDir, shared);
  assert.equal(loc.root, repo, "stamps the caller's checkout");
  assert.equal(loc.mainRoot, path.dirname(shared), "shots stay beside the brain");
  const nowhere = tmpDir(t);
  assert.equal(locate(nowhere, { brain: shared }).root, path.dirname(shared), "no caller repo: the brain's parent");
});

test("locate: worktrees of a --separate-git-dir repo share the main checkout's brain (never a second one)", (t) => {
  const base = tmpDir(t);
  const main = path.join(base, "main");
  git(base, "init", "-q", "-b", "main", "--separate-git-dir", path.join(base, "store.git"), main);
  git(main, "config", "user.email", "t@example.com");
  git(main, "config", "user.name", "Test Author");
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  const wt = path.join(base, "wt");
  git(main, "worktree", "add", "-q", wt, "-b", "wt-branch");

  // The main checkout has not run brain yet: git records no path for it, so
  // the worktree refuses to guess (no split brain), naming the two ways out.
  assert.equal(locate(wt).mainUnknown, true);
  const e = throwsCode(() => create(wt), "MAIN_CHECKOUT_UNKNOWN");
  assert.ok(e.help.some((h) => /--brain/.test(h)));
  throwsCode(() => openBrain(wt), "MAIN_CHECKOUT_UNKNOWN");
  assert.ok(!fs.existsSync(path.join(wt, ".brain")));

  const b = create(main);
  t.after(() => close(b.db));
  const loc = locate(wt);
  assert.equal(loc.brainDir, path.join(main, ".brain"));
  assert.equal(loc.root, wt);
  assert.equal(loc.worktree, true);
  assert.equal(loc.mainUnknown, undefined);
  const w = openBrain(wt);
  close(w.db);
  assert.equal(locate(main).brainDir, path.join(main, ".brain"), "the main checkout is its own main");

  // A stale record (that checkout no longer points at this git dir) is ignored.
  fs.writeFileSync(path.join(base, "store.git", "brain-axi-main-checkout"), base + "\n");
  assert.equal(locate(wt).mainUnknown, true);
});

test("locate: a --separate-git-dir named .git (/storage/.git) never makes its parent the main checkout", (t) => {
  const base = tmpDir(t);
  const main = path.join(base, "main");
  fs.mkdirSync(path.join(base, "storage"));
  git(base, "init", "-q", "-b", "main", "--separate-git-dir", path.join(base, "storage", ".git"), main);
  git(main, "config", "user.email", "t@example.com");
  git(main, "config", "user.name", "Test Author");
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  const loc = locate(main);
  assert.equal(loc.mainRoot, main);
  assert.equal(loc.brainDir, path.join(main, ".brain"));
  const wt = path.join(base, "wt");
  git(main, "worktree", "add", "-q", wt, "-b", "wt-branch");
  assert.equal(locate(wt).brainDir, path.join(main, ".brain"), "its worktree follows the recorded main checkout");
});
