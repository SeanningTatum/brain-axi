// scripts/eval-record.mjs gate: frozen cases, min_pass_rate, and the
// aggregate_tolerance band against the previous recorded run.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordRun } from "../scripts/eval-record.mjs";

function suite(t, thresholds) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "brain-evalrec-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "suite.json"), JSON.stringify({ version: 1, kind: "judge", thresholds }));
  const ids = Array.from({ length: 34 }, (_, i) => `c${i}`);
  fs.writeFileSync(path.join(dir, "cases.jsonl"), ids.map((id) => JSON.stringify({ id })).join("\n") + "\n");
  const run = (failing) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); // run files are named by ms timestamp
    return recordRun(dir, dir, { cases: ids.map((id, i) => ({ id, pass: i >= failing })) });
  };
  return { dir, run };
}

test("eval-record: a drop beyond aggregate_tolerance fails the gate even above min_pass_rate", (t) => {
  const { run } = suite(t, { min_pass_rate: 0.9, aggregate_tolerance: 0.05 });
  assert.equal(run(0).gateFailed, false, "34/34 baseline");
  const r = run(3); // 31/34 ≈ 0.912: above 0.9, but ~0.088 below the previous run
  assert.equal(r.gateFailed, true);
  assert.match(r.gateReason, /aggregate_tolerance 0\.05/);
  assert.equal(run(3).gateFailed, false, "steady at 31/34 is within tolerance");
  assert.equal(run(4).gateFailed, true, "30/34 is below min_pass_rate");
});

// A suite with explicit cases (some frozen) and a runner envelope as given.
function frozenSuite(t, golden, thresholds = { min_pass_rate: 0.5 }) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "brain-evalrec-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "suite.json"), JSON.stringify({ version: 1, kind: "judge", thresholds }));
  fs.writeFileSync(path.join(dir, "cases.jsonl"), golden.map((c) => JSON.stringify(c)).join("\n") + "\n");
  const saved = (r) => JSON.parse(fs.readFileSync(path.join(dir, r.runFile), "utf8"));
  return { dir, saved };
}

test("eval-record: a failing frozen case fails the gate even with the score above min_pass_rate", (t) => {
  const golden = [{ id: "f1", frozen: true }, ...Array.from({ length: 9 }, (_, i) => ({ id: `c${i}` }))];
  const { dir, saved } = frozenSuite(t, golden);
  const r = recordRun(dir, dir, { cases: golden.map((c) => ({ id: c.id, pass: c.id !== "f1" })) }); // 9/10
  assert.equal(r.gateFailed, true);
  assert.match(r.gateReason, /frozen case\(s\) failing: f1/);
  assert.deepEqual(r.summary.frozen_failing, ["f1"]);
  const run = saved(r);
  assert.deepEqual(run.cases.find((c) => c.id === "f1"), { id: "f1", frozen: true, pass: false, score: 0, output: "", notes: "", missing: false });
  assert.equal(run.summary.partial, false);
});

test("eval-record: a case missing from the runner output is a recorded failure (frozen: the gate fails)", (t) => {
  const golden = [{ id: "f1", frozen: true }, { id: "c1" }, { id: "c2" }, { id: "c3" }];
  // Frozen case missing: gate fails on it.
  const a = frozenSuite(t, golden);
  const ra = recordRun(a.dir, a.dir, { cases: [{ id: "c1", pass: true }, { id: "c2", pass: true }, { id: "c3", pass: true }] });
  assert.equal(ra.gateFailed, true);
  assert.match(ra.gateReason, /frozen case\(s\) failing: f1/);
  const sa = a.saved(ra);
  assert.equal(sa.summary.partial, true);
  assert.deepEqual(sa.cases.find((c) => c.id === "f1"), { id: "f1", frozen: true, pass: false, score: 0, output: "", notes: "missing from the runner output", missing: true });
  // Ordinary case missing: counted as a failure (3/4 = 0.75 >= 0.5 passes the gate) and marked partial.
  const b = frozenSuite(t, golden);
  const rb = recordRun(b.dir, b.dir, { cases: [{ id: "f1", pass: true }, { id: "c1", pass: true }, { id: "c2", pass: true }, { id: "extra", pass: true }] });
  assert.equal(rb.gateFailed, false);
  assert.deepEqual([rb.summary.pass, rb.summary.total, rb.summary.failing, rb.summary.partial], [3, 4, ["c3"], true]);
  const sb = b.saved(rb);
  assert.equal(sb.cases.find((c) => c.id === "c3").missing, true);
  assert.deepEqual(sb.unknown_case_ids, ["extra"]);
  // Below min_pass_rate once enough cases are missing.
  const c = frozenSuite(t, golden, { min_pass_rate: 0.9 });
  const rc = recordRun(c.dir, c.dir, { cases: [{ id: "f1", pass: true }] });
  assert.equal(rc.gateFailed, true);
  assert.match(rc.gateReason, /below min_pass_rate 0\.9/);
});
