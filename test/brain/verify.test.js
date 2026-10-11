import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { features, verify } from "../../lib/brain/index.js";
import { freshBrain, throwsCode, rejectsRaw } from "./helpers.js";
import { supervise, killTree, TIMEOUT_MARK, TIMEOUT_EXIT } from "../../lib/brain/verify-supervisor.js";

test("addCheck, listChecks by stage, CHECK_EXISTS and replace, removeCheck", (t) => {
  const { db } = freshBrain(t);
  const c = verify.addCheck(db, { name: "unit", run: "node --test", stages: ["verify", "baseline"], timeout: 60 });
  assert.deepEqual(c, { name: "unit", run: "node --test", stages: ["baseline", "verify"], timeout: 60, replaced: false });
  verify.addCheck(db, { name: "setup", run: "npm ci", stages: ["bootstrap"] });
  assert.deepEqual(verify.listChecks(db).map((x) => x.name), ["unit", "setup"]);
  assert.deepEqual(verify.listChecks(db, { stage: "bootstrap" }).map((x) => x.name), ["setup"]);
  assert.equal(verify.listChecks(db)[1].timeout, 300);
  throwsCode(() => verify.addCheck(db, { name: "unit", run: "x" }), "CHECK_EXISTS");
  assert.equal(verify.addCheck(db, { name: "unit", run: "npm test", replace: true }).replaced, true);
  assert.equal(verify.listChecks(db)[0].run, "npm test");
  assert.deepEqual(verify.removeCheck(db, "setup"), { removed: "setup" });
  throwsCode(() => verify.removeCheck(db, "setup"), "NOT_FOUND");
});

test("addCheck validation and the stages CHECK in the schema", (t) => {
  const { db } = freshBrain(t);
  throwsCode(() => verify.addCheck(db, { name: "a b", run: "x" }), "INVALID_NAME");
  throwsCode(() => verify.addCheck(db, { name: "a", run: " " }), "INVALID_ARG");
  throwsCode(() => verify.addCheck(db, { name: "a", run: "x", stages: [] }), "INVALID_STAGE");
  throwsCode(() => verify.addCheck(db, { name: "a", run: "x", stages: ["evals"] }), "INVALID_STAGE");
  throwsCode(() => verify.addCheck(db, { name: "a", run: "x", timeout: 0 }), "INVALID_ARG");
  throwsCode(() => verify.listChecks(db, { stage: "nope" }), "INVALID_STAGE");
  for (const bad of ["verifyx", "evals", "", "baseline,", "baseline verify"])
    rejectsRaw(db, "INSERT INTO verify_checks (name, run, stages) VALUES ('raw', 'x', ?)", bad);
  db.prepare("INSERT INTO verify_checks (name, run, stages) VALUES ('raw', 'x', 'bootstrap,baseline,verify')").run();
});

test("run with zero declared checks throws NO_CHECKS (#10)", (t) => {
  const { db, root } = freshBrain(t);
  const e = throwsCode(() => verify.run(db, { root }), "NO_CHECKS");
  assert.ok(e.help.some((h) => h.startsWith("declare real checks with brain verify add")));
  verify.addCheck(db, { name: "only-boot", run: "true", stages: ["bootstrap"] });
  throwsCode(() => verify.run(db, { stage: "verify", root }), "NO_CHECKS", /stage verify/);
  throwsCode(() => verify.run(db, { only: ["ghost"], root }), "NOT_FOUND");
});

test("run executes sequentially in root, reports pass/fail/timeout with tails and records gate rows", (t) => {
  const { db, root } = freshBrain(t);
  features.add(db, { slug: "f", name: "F" });
  verify.addCheck(db, { name: "ok", run: "pwd && echo fine", stages: ["verify"] });
  verify.addCheck(db, { name: "bad", run: "echo oops >&2; exit 3", stages: ["verify"] });
  verify.addCheck(db, { name: "slow", run: "sleep 5", stages: ["verify"], timeout: 1 });
  verify.addCheck(db, { name: "boot", run: "true", stages: ["bootstrap"] });
  const seen = [];
  const r = verify.run(db, { stage: "verify", root, feature: "f", onResult: (x) => seen.push(x.check) });
  assert.equal(r.ok, false);
  assert.deepEqual(seen, ["ok", "bad", "slow"]);
  const [ok, bad, slow] = r.results;
  assert.equal(ok.status, "pass");
  assert.equal(ok.tail, `${root}\nfine`);
  assert.deepEqual([bad.status, bad.exit, bad.tail], ["fail", 3, "oops"]);
  assert.deepEqual([slow.status, slow.exit], ["timeout", null]);
  const rows = verify.gateRuns(db);
  assert.deepEqual(rows.map((g) => [g.check, g.status, g.stage, g.feature]).reverse(), [
    ["ok", "pass", "verify", "f"],
    ["bad", "fail", "verify", "f"],
    ["slow", "timeout", "verify", "f"],
  ]);
  const only = verify.run(db, { only: ["boot"], root });
  assert.deepEqual([only.ok, only.stage, only.results.length], [true, null, 1]);
  assert.equal(verify.gateRuns(db, { check: "boot" }).length, 1);
});

test("a timed-out check takes its whole process tree with it; a check's own SIGALRM is a plain failure", async (t) => {
  const { db, root } = freshBrain(t);
  const marker = path.join(root, "leaked");
  verify.addCheck(db, { name: "hang", run: `node -e "setTimeout(() => require('fs').writeFileSync('leaked', 'x'), 2500)" & wait`, timeout: 1 });
  verify.addCheck(db, { name: "alrm", run: "kill -ALRM $$" });
  const [hang, alrm] = verify.run(db, { root }).results;
  assert.equal(hang.status, "timeout");
  assert.ok(hang.seconds < 5, `took ${hang.seconds}s`);
  assert.equal(alrm.status, "fail");
  await new Promise((r) => setTimeout(r, 3000));
  assert.ok(!fs.existsSync(marker), "the timed-out check's child kept running");
});

test("shipHint names the declared checks, never a hardcoded runner", (t) => {
  const { db } = freshBrain(t);
  assert.match(verify.shipHint(db, "f")[0], /No checks are declared/);
  verify.addCheck(db, { name: "base", run: "make base", stages: ["baseline"] });
  assert.match(verify.shipHint(db, "f")[0], /brain verify run \(base: make base\)/);
  verify.addCheck(db, { name: "e2e", run: "make e2e", stages: ["verify"] });
  assert.match(verify.shipHint(db, "f")[0], /brain verify run --stage verify \(e2e: make e2e\)/);
});

test("a check printing more than 1 MiB still passes, with only the tail kept", (t) => {
  const { db, root } = freshBrain(t);
  verify.addCheck(db, { name: "loud", run: `node -e "process.stdout.write('x'.repeat(3 * 1024 * 1024) + '\\ndone\\n')"` });
  const r = verify.run(db, { root });
  assert.deepEqual([r.ok, r.results[0].status, r.results[0].exit], [true, "pass", 0]);
  assert.match(r.results[0].tail, /done$/);
  assert.ok(r.results[0].tail.length <= 4001, `tail is capped in bytes too, got ${r.results[0].tail.length} chars`);
  const stored = db.prepare("SELECT max(length(tail)) AS n FROM gate_runs").get();
  if (stored && stored.n != null) assert.ok(stored.n <= 4001);
});

test("checks that already ran are recorded when onResult throws", (t) => {
  const { db, root } = freshBrain(t);
  verify.addCheck(db, { name: "a", run: "true" });
  verify.addCheck(db, { name: "b", run: "true" });
  assert.throws(
    () => verify.run(db, { root, onResult: () => { throw new Error("display broke"); } }),
    /display broke/
  );
  assert.deepEqual(verify.gateRuns(db).map((g) => [g.check, g.status]), [["a", "pass"]]);
});

test("a check's stderr and stdout keep their order in the tail (one stream, not stdout then stderr)", (t) => {
  const { db, root } = freshBrain(t);
  verify.addCheck(db, { name: "mixed", run: "echo first >&2; echo second; echo third >&2" });
  const r = verify.run(db, { root });
  assert.equal(r.results[0].tail, "first\nsecond\nthird");
});

test("each finished check is recorded before the next one starts", (t) => {
  const { db, root } = freshBrain(t);
  verify.addCheck(db, { name: "a", run: "true" });
  verify.addCheck(db, { name: "b", run: "false" });
  const seen = [];
  verify.run(db, { root, onResult: (r) => seen.push([r.check, verify.gateRuns(db).length]) });
  assert.deepEqual(seen, [["a", 1], ["b", 2]]);
});

test("supervisor platform branch: POSIX kills the process group + SIGALRM; Windows taskkill /T /F + a stderr mark, no SIGALRM", async () => {
  const calls = [];
  const kill = (pid, sig) => calls.push(["kill", pid, sig]);
  const spawnSync = (cmd, args) => calls.push(["spawnSync", cmd, args]);
  const run = (platform) =>
    new Promise((resolve) => {
      calls.length = 0;
      const child = new EventEmitter();
      child.pid = 4242;
      const exit = (code) => {
        calls.push(["exit", code]);
        resolve(calls.slice());
      };
      const writeSync = (fd, s) => calls.push(["write", fd, s]);
      const spawn = (cmd, opts) => {
        calls.push(["spawn", cmd, opts.detached]);
        return child;
      };
      supervise("sleep 60", 20, { platform, spawn, kill, spawnSync, exit, writeSync, onSignal: () => {}, pid: 7 });
      if (platform !== "win32") setTimeout(() => resolve(calls.slice()), 100); // SIGALRM ends a real supervisor
    });

  assert.deepEqual(await run("linux"), [["spawn", "sleep 60", true], ["kill", -4242, "SIGKILL"], ["kill", 7, "SIGALRM"]]);
  assert.deepEqual(await run("win32"), [
    ["spawn", "sleep 60", false],
    ["spawnSync", "taskkill", ["/pid", "4242", "/T", "/F"]],
    ["write", 2, TIMEOUT_MARK],
    ["exit", TIMEOUT_EXIT],
  ]);
  // A failing taskkill (or kill) is ignored.
  assert.doesNotThrow(() => killTree(1, { platform: "win32", spawnSync: () => { throw new Error("ENOENT"); } }));
  assert.doesNotThrow(() => killTree(1, { platform: "darwin", kill: () => { throw new Error("ESRCH"); } }));
  // runOne's reading of a Windows supervisor's timeout: the mark, stripped from the tail.
  const r = verify.outcome({ name: "w" }, { status: TIMEOUT_EXIT, signal: null, stdout: "partial\n", stderr: TIMEOUT_MARK }, 1);
  assert.deepEqual([r.status, r.exit, r.tail], ["timeout", null, "partial"]);
  const own = verify.outcome({ name: "w" }, { status: TIMEOUT_EXIT, signal: null, stdout: "x\n", stderr: "" }, 1);
  assert.deepEqual([own.status, own.exit], ["fail", TIMEOUT_EXIT], "a check's own exit 124 is a plain failure");
});
