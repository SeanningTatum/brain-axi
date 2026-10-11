// lib/brain/verify.js — the declared project-check registry and its runner.
// Checks run sequentially from the repo root; every run records gate rows.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BrainError } from "./errors.js";
import { lookup } from "./features.js";
import { NAME_RE, gitBranch, gitHead, now, plain, tx } from "./util.js";
import { TIMEOUT_EXIT, TIMEOUT_MARK } from "./verify-supervisor.js";

export const STAGES = ["bootstrap", "baseline", "verify"];
export const DEFAULT_TIMEOUT = 300;
const TAIL_LINES = 15;

const shape = (r) => ({ ...plain(r), stages: r.stages.split(",") });

function assertStage(stage) {
  if (!STAGES.includes(stage))
    throw new BrainError("INVALID_STAGE", `invalid stage "${stage}"`, [`valid stages: ${STAGES.join(", ")}`]);
}

// [{ name, run, stages: [], timeout }] by declaration order; `stage` filters.
export function listChecks(db, { stage } = {}) {
  if (stage !== undefined) assertStage(stage);
  return db
    .prepare("SELECT name, run, stages, timeout FROM verify_checks ORDER BY id")
    .all()
    .map(shape)
    .filter((c) => !stage || c.stages.includes(stage));
}

// Declare a check. `replace` overwrites one with the same name.
export function addCheck(db, { name, run, stages = ["verify"], timeout = DEFAULT_TIMEOUT, replace = false } = {}) {
  if (typeof name !== "string" || !NAME_RE.test(name))
    throw new BrainError("INVALID_NAME", `invalid check name "${name}" — letters, digits, ".", "_" and "-"`, [
      'brain verify add test --run "npm test" --stages baseline,verify',
    ]);
  if (typeof run !== "string" || !run.trim())
    throw new BrainError("INVALID_ARG", "run is required — the shell command for this check", [
      `brain verify add ${name} --run "<command>" --stages baseline,verify`,
    ]);
  if (!Array.isArray(stages) || !stages.length)
    throw new BrainError("INVALID_STAGE", "at least one stage is required", [`valid stages: ${STAGES.join(", ")}`]);
  stages.forEach(assertStage);
  if (!Number.isInteger(timeout) || timeout <= 0)
    throw new BrainError("INVALID_ARG", `timeout must be a positive whole number of seconds, got ${timeout}`, [
      `brain verify add ${name} --run "${run}" --timeout 300`,
    ]);
  const ordered = STAGES.filter((s) => stages.includes(s)).join(",");
  return tx(db, () => {
    const exists = db.prepare("SELECT 1 FROM verify_checks WHERE name = ?").get(name);
    if (exists && !replace)
      throw new BrainError("CHECK_EXISTS", `check "${name}" is already declared`, [
        "brain verify list",
        `Replace it: brain verify add ${name} --run "..." --replace`,
      ]);
    if (exists) db.prepare("UPDATE verify_checks SET run = ?, stages = ?, timeout = ? WHERE name = ?").run(run, ordered, timeout, name);
    else db.prepare("INSERT INTO verify_checks (name, run, stages, timeout) VALUES (?, ?, ?, ?)").run(name, run, ordered, timeout);
    return { ...shape(db.prepare("SELECT name, run, stages, timeout FROM verify_checks WHERE name = ?").get(name)), replaced: !!exists };
  });
}

export function removeCheck(db, name) {
  const { changes } = db.prepare("DELETE FROM verify_checks WHERE name = ?").run(name);
  if (!changes) throw new BrainError("NOT_FOUND", `no check "${name}"`, ["brain verify list"]);
  return { removed: name };
}

// The last `n` lines, and at most TAIL_CHARS of them: one huge line must not
// land whole in gate_runs (or on the terminal).
const TAIL_CHARS = 4000;
function tail(text, n = TAIL_LINES) {
  const lines = (text || "").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const out = lines.slice(-n).join("\n");
  return out.length > TAIL_CHARS ? "…" + out.slice(-TAIL_CHARS) : out;
}

// Verbose suites print far more than spawnSync's 1 MiB default; only the tail
// is kept, but the buffer must hold the whole run or the check is killed.
export const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

// A check runs under a tiny Node supervisor (verify-supervisor.js) that kills
// the check's WHOLE process tree on timeout or when it is signalled (Ctrl-C,
// the outer kill), so a timed-out `npm test` cannot leave its node children
// running into the next check. POSIX: a process group, timeout reported as
// SIGALRM. Windows: `taskkill /T /F`, timeout reported as TIMEOUT_MARK on the
// supervisor's own stderr (the check's stderr is merged into stdout).
const SUPERVISOR = fileURLToPath(new URL("./verify-supervisor.js", import.meta.url));

// The result row for one finished supervisor run (`res` from spawnSync).
export function outcome(check, res, seconds) {
  const err = res.stderr || "";
  const marked = err.includes(TIMEOUT_MARK);
  const output = (res.stdout || "") + err.split(TIMEOUT_MARK).join("");
  if (res.signal === "SIGALRM" || (marked && res.status === TIMEOUT_EXIT) || (res.error && res.error.code === "ETIMEDOUT"))
    return { check: check.name, status: "timeout", exit: null, seconds, tail: tail(output) };
  if (res.error && res.error.code === "ENOBUFS")
    return { check: check.name, status: "fail", exit: null, seconds, tail: `${tail(output, TAIL_LINES - 1)}\n[brain] output exceeded ${MAX_OUTPUT_BYTES} bytes; the check was killed` };
  return { check: check.name, status: res.status === 0 ? "pass" : "fail", exit: res.status, seconds, tail: tail(output) };
}

function runOne(check, cwd) {
  const start = Date.now();
  const res = spawnSync(process.execPath, [SUPERVISOR, check.run, String(check.timeout * 1000)], {
    cwd,
    timeout: check.timeout * 1000 + 10000, // backstop only: the supervisor enforces the real timeout
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT_BYTES,
    windowsHide: true,
  });
  return outcome(check, res, Number(((Date.now() - start) / 1000).toFixed(1)));
}

// Run declared checks (by `stage`, or `only` names) in `root`. Zero declared
// checks throws NO_CHECKS (#10). Results are recorded as gate_runs rows.
// Returns { stage, ok, results: [{ check, status, exit, seconds, tail }] }.
export function run(db, { stage, only, root = process.cwd(), feature, onResult } = {}) {
  if (stage !== undefined) assertStage(stage);
  const all = listChecks(db);
  if (!all.length)
    throw new BrainError("NO_CHECKS", "no verify checks are declared", [
      'declare real checks with brain verify add <name> --run "<command>" --stages baseline,verify',
    ]);
  let checks = stage ? all.filter((c) => c.stages.includes(stage)) : all;
  if (only && only.length) {
    const missing = only.filter((n) => !all.some((c) => c.name === n));
    if (missing.length)
      throw new BrainError("NOT_FOUND", `no check named ${missing.join(", ")}`, [`declared: ${all.map((c) => c.name).join(", ")}`]);
    checks = checks.filter((c) => only.includes(c.name));
  }
  if (!checks.length)
    throw new BrainError("NO_CHECKS", `no declared check matches${stage ? ` stage ${stage}` : ""}${only && only.length ? ` and ${only.join(",")}` : ""}`, [
      "brain verify list",
      'declare real checks with brain verify add <name> --run "<command>" --stages ' + (stage || "verify"),
    ]);
  const fid = feature ? lookup(db, feature).id : null;
  const results = [];
  // Each completed check is recorded as soon as it finishes (a short write,
  // never a lock held while a command runs), so an interrupted run or a
  // throwing onResult keeps the history of the checks that did finish.
  const at = now();
  const branch = gitBranch(root);
  const commit = gitHead(root);
  const ins = db.prepare(
    `INSERT INTO gate_runs (at, stage, check_name, status, exit, seconds, tail, branch, commit_sha, feature_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const c of checks) {
    const r = runOne(c, root);
    results.push(r);
    tx(db, () => ins.run(at, stage || null, r.check, r.status, r.exit, r.seconds, r.tail, branch, commit, fid));
    if (onResult) onResult(r);
  }
  return { stage: stage || null, ok: results.every((r) => r.status === "pass"), results };
}

// Recent gate rows, newest first.
export function gateRuns(db, { limit = 50, check } = {}) {
  return db
    .prepare(
      `SELECT g.at, g.stage, g.check_name AS "check", g.status, g.exit, g.seconds, g.branch, g.commit_sha AS "commit", f.slug AS feature
       FROM gate_runs g LEFT JOIN features f ON f.id = g.feature_id
       ${check ? "WHERE g.check_name = ?" : ""} ORDER BY g.id DESC LIMIT ?`
    )
    .all(...(check ? [check] : []), limit)
    .map(plain);
}

// The next-step lines for a refused ship, built from what this project
// actually declares — never a hardcoded runner (#4).
export function shipHint(db, slug) {
  const checks = listChecks(db, { stage: "verify" });
  const all = checks.length ? checks : listChecks(db);
  return [
    all.length
      ? `Run the declared checks: brain verify run${checks.length ? " --stage verify" : ""} (${all.map((c) => `${c.name}: ${c.run}`).join("; ")})`
      : 'No checks are declared — declare real ones: brain verify add <name> --run "<command>" --stages verify',
    `Record a PASS from an independent verifier: brain verifications add ${slug} --verdict PASS --body "..."`,
    `Then: brain features ship ${slug} --evidence "..."`,
  ];
}
