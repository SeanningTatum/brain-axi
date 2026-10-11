// lib/brain/verify-supervisor.js — the tiny process `brain verify` runs each
// check under: `node verify-supervisor.js <shell command> <timeout ms>`.
//
// It runs the shell command with stderr merged into stdout (one stream, in
// order). On timeout — or when the supervisor itself is signalled (Ctrl-C,
// the outer kill) — it kills the check's WHOLE process tree, so a timed-out
// `npm test` cannot leave its node children running into the next check:
//   - POSIX: the shell runs in its own process group; the group is SIGKILLed,
//     and the supervisor reports a timeout by dying of SIGALRM (which a
//     check's own exit can never produce through the supervisor).
//   - Windows: no process groups or SIGALRM; the tree is killed with
//     `taskkill /pid <pid> /T /F`, and the timeout is reported as TIMEOUT_MARK
//     on the supervisor's own stderr (the check's output never reaches it)
//     plus exit code TIMEOUT_EXIT. Known limit: a job the check backgrounds
//     (`start /b`) and leaves running after its shell exits is not reached —
//     taskkill cannot walk a tree whose root is gone.
// It also watches its parent (`brain verify`): when that process is gone —
// killed by a SIGTERM aimed at it alone, which never reaches this separate
// process — the supervisor kills the check's tree and exits, so a cancelled
// run cannot keep changing files until the check's own timeout.
// Every platform-specific step takes its dependencies as arguments so both
// branches are unit-tested on any OS.

import { spawn as cpSpawn, spawnSync as cpSpawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

export const TIMEOUT_MARK = "\u0000brain-verify-timeout\n";
export const TIMEOUT_EXIT = 124;

// Kill `pid` and every process under it. Errors (already gone, no taskkill)
// are ignored: this is best-effort cleanup.
export function killTree(pid, { platform = process.platform, kill = process.kill.bind(process), spawnSync = cpSpawnSync } = {}) {
  if (!pid) return;
  if (platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      // taskkill missing or failed: nothing more to do
    }
    return;
  }
  try {
    kill(-pid, "SIGKILL");
  } catch {
    // the group is already gone
  }
}

// Report "timed out" to the parent (verify.js runOne).
export function reportTimeout({
  platform = process.platform,
  kill = process.kill.bind(process),
  exit = process.exit,
  writeSync = fs.writeSync,
  pid = process.pid,
} = {}) {
  if (platform === "win32") {
    try {
      writeSync(2, TIMEOUT_MARK);
    } catch {
      // stderr closed: the exit code alone still reads as a failure
    }
    exit(TIMEOUT_EXIT);
    return;
  }
  kill(pid, "SIGALRM");
}

// Run `cmd` with a `ms` timeout; see the header for the contract.
export function supervise(cmd, ms, deps = {}) {
  const {
    platform = process.platform,
    spawn = cpSpawn,
    kill = process.kill.bind(process),
    spawnSync = cpSpawnSync,
    exit = process.exit,
    writeSync = fs.writeSync,
    onSignal = (sig, fn) => process.on(sig, fn),
    pid = process.pid,
    parentAlive = parentWatcher(),
    watchMs = 500,
  } = deps;
  const win = platform === "win32";
  // detached on Windows would open a console window and buys no process group.
  const c = spawn(cmd, { shell: true, detached: !win, windowsHide: true, stdio: ["ignore", 1, 1] });
  const killAll = () => killTree(c.pid, { platform, kill, spawnSync });
  let watch = null;
  const stop = () => {
    clearTimeout(t);
    if (watch) clearInterval(watch);
  };
  const t = setTimeout(() => {
    stop();
    killAll();
    reportTimeout({ platform, kill, exit, writeSync, pid });
  }, Number(ms));
  watch = setInterval(() => {
    if (parentAlive()) return;
    stop();
    killAll();
    exit(130);
  }, watchMs);
  if (watch.unref) watch.unref();
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"])
    onSignal(sig, () => {
      stop();
      killAll();
      exit(130);
    });
  c.on("error", () => {
    stop();
    exit(127);
  });
  c.on("exit", (code, signal) => {
    stop();
    killAll(); // background children the check left behind
    exit(code ?? 128 + (os.constants.signals[signal] || 0));
  });
  return c;
}

// Is the process that started this one still there? POSIX reparents an
// orphan (ppid changes); Windows does not, so the original pid is probed.
export function parentWatcher({ getPpid = () => process.ppid, probe = (p) => process.kill(p, 0) } = {}) {
  const first = getPpid();
  return () => {
    if (getPpid() !== first) return false;
    try {
      probe(first);
      return true;
    } catch (e) {
      return e.code === "EPERM"; // alive, owned by someone else
    }
  };
}

function isMain() {
  try {
    return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) supervise(process.argv[2], process.argv[3]);
