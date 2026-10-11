import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { create, open, close, features, tasks, progress, runs, docs, plans, verifications, verify, search, io, check } from "../../lib/brain/index.js";
import { schemaVersion } from "../../lib/brain/db.js";
import { freshBrain, tmpDir, throwsCode } from "./helpers.js";

// A brain with a row in every table, and awkward strings throughout.
function rich(t) {
  const b = freshBrain(t);
  const { db, root } = b;
  features.add(db, { slug: "base", name: "Base, with comma", description: 'quotes "x", colon: y\nnew line\ttab \\ backslash' });
  features.add(db, { slug: "kanban", name: "123 numeric-looking", dependsOn: ["base"], status: "in-progress", prUrl: "https://x.io/pull/1" });
  features.add(db, { slug: "legacy", name: "true", status: "shipped", evidence: "-dash first | pipe", grandfathered: true });
  tasks.add(db, "kanban", { title: "null", acceptance: " leading space", files: ["a.js", "b c.js"] });
  tasks.add(db, "kanban", { title: "t2", acceptance: "ok", dependsOn: ["t1"] });
  tasks.claim(db, "kanban", { key: "t1", by: "agent" });
  progress.add(db, { summary: "émoji 🚀 and ümlauts", next: "", body: null, feature: "kanban", run: "r1", root });
  runs.append(db, "kanban", { run: "r1", step: "step", observed: "line1\nline2\r\n", task: "t1", author: "me" });
  docs.set(db, "rules", "r", "# R\n- a, b: c");
  fs.writeFileSync(path.join(root, "plan.html"), "<title>Plan</title>");
  plans.upsert(db, { file: "plan.html", feature: "kanban", root });
  plans.addRound(db, "plan", { prompts: [{ prompt: "p", tag: "decision", target: { a: [1, "2"], b: null } }], endedBy: "sean" });
  fs.mkdirSync(path.join(root, ".brain", "shots"), { recursive: true });
  fs.writeFileSync(path.join(root, ".brain", "shots", "s.png"), "png");
  verifications.add(db, "kanban", { verdict: "FAIL", body: "0.5 seconds", shots: [{ path: ".brain/shots/s.png", caption: "cap" }], root });
  verify.addCheck(db, { name: "unit", run: 'echo "a,b" | cat', stages: ["baseline", "verify"], timeout: 7 });
  verify.run(db, { root });
  return b;
}

test("export → import → export is byte-identical, and the import is a working brain", (t) => {
  const a = rich(t);
  const dump = io.exportAll(a.db);
  assert.match(dump, new RegExp(`^format: brain-export\\nversion: 1\\nschema: ${schemaVersion(a.db)}\\n`));
  for (const tbl of io.TABLES) assert.match(dump, new RegExp(`^${tbl}\\[\\d+\\]\\{`, "m"));

  const dir = tmpDir(t);
  const b = create(dir, { gitignore: false });
  t.after(() => close(b.db));
  const res = io.importAll(b.db, dump);
  assert.equal(res.rows.features, 3);
  assert.equal(res.rows.gate_runs, 1);
  assert.equal(io.exportAll(b.db), dump);

  assert.equal(features.get(b.db, "base").description, 'quotes "x", colon: y\nnew line\ttab \\ backslash');
  assert.equal(features.get(b.db, "kanban").name, "123 numeric-looking");
  assert.equal(features.get(b.db, "legacy").name, "true");
  assert.equal(tasks.get(b.db, "kanban", "t1").acceptance, " leading space");
  assert.deepEqual(plans.get(b.db, "plan").reviews[0].prompts[0].target, { a: [1, "2"], b: null });
  assert.equal(search.query(b.db, "ümlauts").length, 1, "search index rebuilt by triggers");
  assert.deepEqual(check(b.db, { root: a.root }).filter((r) => r.status === "fail"), []);
  // the one-in-progress rule still holds on the imported brain
  throwsCode(() => features.set(b.db, "base", { status: "in-progress" }), "ONE_IN_PROGRESS");
});

test("import refuses a non-empty brain, a newer format, and malformed dumps", (t) => {
  const a = rich(t);
  const dump = io.exportAll(a.db);
  throwsCode(() => io.importAll(a.db, dump), "IMPORT_NOT_EMPTY");

  const { db } = freshBrain(t);
  throwsCode(() => io.importAll(db, dump.replace("version: 1", "version: 2")), "IMPORT_VERSION");
  throwsCode(() => io.importAll(db, dump.replace(/^schema: \d+$/m, "schema: 99")), "IMPORT_VERSION");
  throwsCode(() => io.importAll(db, "hello"), "IMPORT_PARSE");
  throwsCode(() => io.importAll(db, "version: 1\n"), "IMPORT_PARSE", /not a brain export/);
  throwsCode(() => io.importAll(db, dump.replace("features[3]", "features[4]")), "IMPORT_PARSE");
  throwsCode(() => io.importAll(db, dump.replace("docs[1]{id,", "docs[1]{id,bogus,")), "IMPORT_PARSE");
  throwsCode(() => io.importAll(db, dump + "widgets[0]{x}:\n"), "IMPORT_PARSE", /unknown table/);
  throwsCode(() => io.importAll(db, dump + "\n" + dump.slice(dump.indexOf("features["))), "IMPORT_PARSE", /appears twice/);
  assert.equal(features.list(db).length, 0, "a failed import writes nothing");
});

test("an older dump without newer columns loads with defaults", (t) => {
  const { db } = freshBrain(t);
  const old = [
    "format: brain-export",
    "version: 1",
    "schema: 1",
    "features[1]{id,slug,name,status,created,updated}:",
    '  1,old,Old,planned,"2026-01-01T00:00:00.000Z","2026-01-01T00:00:00.000Z"',
    "",
  ].join("\n");
  io.importAll(db, old);
  const f = features.get(db, "old");
  assert.equal(f.grandfathered, false);
  assert.equal(f.description, null);
});

test("exportAll reads one snapshot: a write landing mid-export cannot orphan child rows", (t) => {
  const a = freshBrain(t);
  features.add(a.db, { slug: "first", name: "First" });
  const other = open(a.dbPath);
  t.after(() => close(other));
  let wrote = false;
  // Another worktree adds a feature and its task right after the features table is read.
  const racing = {
    get isTransaction() {
      return a.db.isTransaction;
    },
    exec: (sql) => a.db.exec(sql),
    prepare(sql) {
      const stmt = a.db.prepare(sql);
      if (!/^SELECT \* FROM features /.test(sql)) return stmt;
      return {
        all: (...args) => {
          const rows = stmt.all(...args);
          if (!wrote) {
            wrote = true;
            features.add(other, { slug: "late", name: "Late" });
            tasks.add(other, "late", { title: "x", acceptance: "y" });
          }
          return rows;
        },
      };
    },
  };
  const dump = io.exportAll(racing);
  assert.ok(wrote);
  const b = create(tmpDir(t), { gitignore: false });
  t.after(() => close(b.db));
  const res = io.importAll(b.db, dump);
  assert.deepEqual([res.rows.features, res.rows.tasks], [1, 0]);
});

test("import refuses a dump whose task dependencies form a cycle, and writes nothing", (t) => {
  const a = freshBrain(t);
  features.add(a.db, { slug: "k", name: "K" });
  tasks.add(a.db, "k", { title: "a", acceptance: "x" });
  tasks.add(a.db, "k", { title: "b", acceptance: "x", dependsOn: ["t1"] });
  const dump = io.exportAll(a.db).replace("task_deps[1]{task_id,depends_on}:\n  2,1", "task_deps[2]{task_id,depends_on}:\n  2,1\n  1,2");
  assert.match(dump, /task_deps\[2\]/);
  const b = create(tmpDir(t), { gitignore: false });
  t.after(() => close(b.db));
  throwsCode(() => io.importAll(b.db, dump), "IMPORT_PARSE", /task_deps has a dependency cycle/);
  assert.equal(b.db.prepare("SELECT count(*) AS n FROM tasks").get().n, 0);
});

test("exportAll handles a table larger than the JS argument limit", (t) => {
  const { db } = freshBrain(t);
  db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 300000)
           INSERT INTO gate_runs (at, check_name, status, seconds) SELECT '2026-01-01T00:00:00.000Z', 'c', 'pass', 0 FROM n`);
  const text = io.exportAll(db);
  assert.match(text, /^gate_runs\[300000\]\{/m);
});
