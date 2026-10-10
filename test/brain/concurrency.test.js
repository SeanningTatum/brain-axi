import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { create, close, features, progress, runs } from "../../lib/brain/index.js";
import { tmpDir, git, gitRepo } from "./helpers.js";

const WRITER = fileURLToPath(new URL("./fixtures/writer.mjs", import.meta.url));
const N = 150;

function runWriter(cwd, label) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [WRITER, cwd, label, String(N)], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${label} exited ${code}: ${err}`))));
  });
}

test("two processes in two worktrees writing at once lose no rows", async (t) => {
  const base = tmpDir(t);
  const main = path.join(base, "main");
  fs.mkdirSync(main);
  gitRepo(main);
  const b = create(main);
  t.after(() => close(b.db));
  features.add(b.db, { slug: "race", name: "Race" });
  const wt = path.join(base, "wt");
  git(main, "worktree", "add", "-q", wt, "-b", "wt");

  await Promise.all([runWriter(main, "main"), runWriter(wt, "wt")]);

  const all = progress.list(b.db, { limit: 10_000 });
  assert.equal(all.length, 2 * N);
  assert.equal(all.filter((c) => c.branch === "main").length, N);
  assert.equal(all.filter((c) => c.branch === "wt").length, N);
  const v = runs.view(b.db, "race");
  assert.deepEqual(v.runs.map((r) => [r.run, r.steps]).sort(), [["main", N], ["wt", N]]);
  // step numbers are dense per run: no lost or duplicated n
  for (const r of ["main", "wt"]) {
    const ns = runs.view(b.db, "race", { run: r }).steps.map((s) => s.n);
    assert.deepEqual(ns, Array.from({ length: N }, (_, i) => i + 1));
  }
});
