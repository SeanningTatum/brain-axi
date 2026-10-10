import { test } from "node:test";
import assert from "node:assert/strict";
import { features, tasks, verifications, runs, progress } from "../../lib/brain/index.js";
import { freshBrain, throwsCode, rejectsRaw } from "./helpers.js";

function setup(t) {
  const b = freshBrain(t);
  features.add(b.db, { slug: "f", name: "F", status: "in-progress" });
  return b;
}

test("add numbers tasks t1..tN, records deps and files; list marks ready", (t) => {
  const { db } = setup(t);
  const t1 = tasks.add(db, "f", { title: "schema", acceptance: "tables exist", files: ["lib/a.js"], verify: "node --test" });
  const t2 = tasks.add(db, "f", { title: "api", acceptance: "routes work", dependsOn: ["t1"] });
  assert.equal(t1.key, "t1");
  assert.equal(t2.key, "t2");
  assert.deepEqual(t1.files, ["lib/a.js"]);
  assert.deepEqual(t2.depends_on, [{ key: "t1", status: "open" }]);
  assert.deepEqual(tasks.list(db, "f").map((x) => [x.key, x.ready]), [["t1", true], ["t2", false]]);
  throwsCode(() => tasks.add(db, "f", { title: "x", acceptance: "y", dependsOn: ["t9"] }), "NOT_FOUND");
  throwsCode(() => tasks.add(db, "f", { title: "x" }), "INVALID_ARG", /acceptance/);
  throwsCode(() => tasks.add(db, "f", { acceptance: "y" }), "INVALID_ARG", /title/);
  throwsCode(() => tasks.get(db, "f", "t7"), "NOT_FOUND");
});

test("get is the brief: task, feature, dependencies, run steps", (t) => {
  const { db } = setup(t);
  tasks.add(db, "f", { title: "a", acceptance: "b" });
  runs.append(db, "f", { run: "r1", step: "did it", observed: "ok", task: "t1" });
  const brief = tasks.get(db, "f", "t1");
  assert.equal(brief.feature_info.slug, "f");
  assert.equal(brief.steps.length, 1);
  assert.equal(brief.steps[0].step, "did it");
});

test("claim: first ready task, a token, refusals for taken or waiting tasks", (t) => {
  const { db } = setup(t);
  tasks.add(db, "f", { title: "a", acceptance: "b" });
  tasks.add(db, "f", { title: "c", acceptance: "d", dependsOn: ["t1"] });
  throwsCode(() => tasks.claim(db, "f", {}), "INVALID_ARG");
  const c = tasks.claim(db, "f", { by: "agent-1" });
  assert.equal(c.task.key, "t1");
  assert.equal(c.task.status, "claimed");
  assert.equal(c.task.claimed_by, "agent-1");
  assert.match(c.token, /^[0-9a-f]{16}$/);
  throwsCode(() => tasks.claim(db, "f", { key: "t1", by: "agent-2" }), "TASK_NOT_CLAIMABLE", /claimed by agent-1/);
  throwsCode(() => tasks.claim(db, "f", { key: "t2", by: "agent-2" }), "TASK_NOT_CLAIMABLE", /waits on t1/);
  throwsCode(() => tasks.claim(db, "f", { by: "agent-2" }), "NO_READY_TASK");
  rejectsRaw(db, "UPDATE tasks SET status = 'claimed' WHERE key = 't2'");
});

test("set: holder-only moves on a claim, release, done needs evidence", (t) => {
  const { db } = setup(t);
  tasks.add(db, "f", { title: "a", acceptance: "b" });
  tasks.add(db, "f", { title: "c", acceptance: "d" });
  const { token } = tasks.claim(db, "f", { key: "t1", by: "me" });
  throwsCode(() => tasks.set(db, "f", "t1", { status: "done", evidence: "x", by: "someone" }), "CLAIM_MISMATCH");
  throwsCode(() => tasks.set(db, "f", "t1", { status: "done" }), "EVIDENCE_REQUIRED");
  throwsCode(() => tasks.set(db, "f", "t1", { status: "claimed" }), "INVALID_STATUS");
  throwsCode(() => tasks.set(db, "f", "t1", { status: "wip" }), "INVALID_STATUS");
  const rel = tasks.set(db, "f", "t1", { status: "open", by: "me" });
  assert.equal(rel.task.status, "open");
  assert.equal(rel.task.claimed_by, null);
  assert.equal(rel.previous, "claimed");
  const again = tasks.claim(db, "f", { key: "t1", by: "you" });
  const done = tasks.set(db, "f", "t1", { status: "done", evidence: "tests green", token: again.token });
  assert.equal(done.task.status, "done");
  assert.equal(done.task.evidence, "tests green");
  assert.equal(done.ship, null, "t2 still open: no autoship");
  rejectsRaw(db, "UPDATE tasks SET status = 'done', evidence = NULL WHERE key = 't2'");
});

test("closing the last open task autoships when the feature has a PASS", (t) => {
  const { db, root } = setup(t);
  tasks.add(db, "f", { title: "a", acceptance: "b" });
  tasks.add(db, "f", { title: "c", acceptance: "d" });
  tasks.set(db, "f", "t2", { status: "cut" });
  verifications.add(db, "f", { verdict: "PASS", body: "walked", root });
  const r = tasks.set(db, "f", "t1", { status: "done", evidence: "all green", root });
  assert.equal(r.ship.outcome, "shipped");
  assert.equal(features.get(db, "f").status, "shipped");
  assert.match(progress.latest(db).summary, /^shipped f: autoship: last open task t1 closed — all green/);
});

test("a refused autoship leaves the task done and throws SHIP_REFUSED with the task (#4)", (t) => {
  const { db, root } = setup(t);
  tasks.add(db, "f", { title: "a", acceptance: "b" });
  const e = throwsCode(() => tasks.set(db, "f", "t1", { status: "done", evidence: "done it", root }), "SHIP_REFUSED");
  assert.equal(e.exitCode, 1);
  assert.match(e.message, /task t1 is marked done; autoship refused/);
  assert.equal(e.detail.task.status, "done");
  assert.ok(e.help.some((h) => /brain verify add|brain verify run/.test(h)));
  assert.equal(tasks.get(db, "f", "t1").status, "done", "the task close is kept");
  assert.equal(features.get(db, "f").status, "in-progress");
});

test("autoship:false skips the ship; closed features take no new tasks", (t) => {
  const { db, root } = setup(t);
  tasks.add(db, "f", { title: "a", acceptance: "b" });
  const r = tasks.set(db, "f", "t1", { status: "done", evidence: "x", autoship: false });
  assert.equal(r.ship, null);
  verifications.add(db, "f", { verdict: "PASS", body: "ok", root });
  features.ship(db, "f", { evidence: "manual", root });
  throwsCode(() => tasks.add(db, "f", { title: "late", acceptance: "x" }), "FEATURE_CLOSED");
});

test("schema: task dependencies cannot cross features", (t) => {
  const { db } = setup(t);
  features.add(db, { slug: "g", name: "G" });
  tasks.add(db, "f", { title: "a", acceptance: "b" });
  tasks.add(db, "g", { title: "a", acceptance: "b" });
  assert.throws(() => db.prepare("INSERT INTO task_deps (task_id, depends_on) VALUES (2, 1)").run(), /crosses features/);
  rejectsRaw(db, "INSERT INTO task_deps (task_id, depends_on) VALUES (1, 1)");
});
