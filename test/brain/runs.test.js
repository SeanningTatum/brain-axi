import { test } from "node:test";
import assert from "node:assert/strict";
import { features, runs, tasks } from "../../lib/brain/index.js";
import { freshBrain, throwsCode } from "./helpers.js";

test("append numbers steps per run, stores observed verbatim; view lists runs and steps", (t) => {
  const { db } = freshBrain(t);
  features.add(db, { slug: "f", name: "F" });
  tasks.add(db, "f", { title: "a", acceptance: "b" });
  const observed = "line 1\n  indented, \"quoted\"\n\ttab";
  const s1 = runs.append(db, "f", { run: "r1", step: "first", observed, task: "t1", author: "agent" });
  const s2 = runs.append(db, "f", { run: "r1", step: "second", observed: "ok" });
  const o1 = runs.append(db, "f", { run: "r2", step: "other", observed: "ok" });
  assert.deepEqual([s1.n, s2.n, o1.n], [1, 2, 1]);
  const all = runs.view(db, "f");
  assert.deepEqual(all.runs.map((r) => [r.run, r.steps]), [["r1", 2], ["r2", 1]]);
  const one = runs.view(db, "f", { run: "r1" });
  assert.equal(one.steps[0].observed, observed);
  assert.equal(one.steps[0].task, "t1");
  assert.equal(one.steps[0].author, "agent");
  const dash = runs.steps(db, "f");
  assert.equal(dash.length, 2);
  assert.equal(dash[0].steps.length, 2);
});

test("default run name is <today>-progress", (t) => {
  const { db } = freshBrain(t);
  features.add(db, { slug: "f", name: "F" });
  const r = runs.append(db, "f", { step: "s", observed: "o" });
  assert.equal(r.run, `${new Date().toISOString().slice(0, 10)}-progress`);
});

test("errors: missing fields, bad names, unknown feature, run or task", (t) => {
  const { db } = freshBrain(t);
  features.add(db, { slug: "f", name: "F" });
  throwsCode(() => runs.append(db, "f", { observed: "o" }), "INVALID_ARG", /step/);
  throwsCode(() => runs.append(db, "f", { step: "s", observed: " " }), "INVALID_ARG", /observed/);
  throwsCode(() => runs.append(db, "f", { run: "../x", step: "s", observed: "o" }), "INVALID_NAME");
  throwsCode(() => runs.append(db, "ghost", { step: "s", observed: "o" }), "NOT_FOUND");
  throwsCode(() => runs.append(db, "f", { step: "s", observed: "o", task: "t9" }), "NOT_FOUND");
  throwsCode(() => runs.view(db, "f", { run: "nope" }), "NOT_FOUND");
});
