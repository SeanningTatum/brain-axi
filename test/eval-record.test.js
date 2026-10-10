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
