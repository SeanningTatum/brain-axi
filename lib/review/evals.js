// lib/review/evals.js — the evals subsystem's data layer: suites, golden
// sets, and run history under `.brain/evals/`.
//
// Zero runtime deps. Pure reads + validation; nothing here writes, spawns, or
// calls a model — `brain evals run` (bin/brain.js) owns execution, this module
// owns the shape of what it reads and writes back.
//
// Layout (one directory per suite):
//
//   .brain/evals/<suite>/
//     suite.json      kind, runner, adapter, thresholds, prompt pointers
//     cases.jsonl     the golden set — one JSON object per line
//     runs.jsonl      run history summaries, newest appended last
//     runs/<ts>.json  full per-case results for one run
//     feedback/<date>.md  human review notes on prompts + outputs
//
// Design notes that are load-bearing, per plan `ai-work-harness`:
// - Prompts live in the APP REPO; a suite holds pointers, never copies. A
//   dangling pointer is a check failure, not a silent skip.
// - Frozen cases are absolute: they may never regress at any aggregate score.
// - Loaders never throw. Malformed state surfaces as a structured error entry
//   so `brain check` can report it instead of a stack trace reaching stdout.

import fs from "node:fs";
import path from "node:path";

export const EVAL_KINDS = ["assertions", "rubric", "judge", "human"];
export const CASE_ORIGINS = ["real", "synthetic", "regression"];
export const EVAL_ADAPTERS = ["envelope", "promptfoo"];

export const SUITE_SNIPPET =
  '{"version":1,"kind":"assertions","runner":"node scripts/eval-<suite>.mjs","thresholds":{"min_pass_rate":0.9}}';

export function evalsDir(brain) {
  return path.join(brain, "evals");
}

export function suiteDir(brain, name) {
  return path.join(evalsDir(brain), name);
}

// The repo root a suite's prompt pointers are relative to. `brain` is
// `<repo>/.brain`, so its parent is the repo.
export function repoRoot(brain) {
  return path.dirname(path.resolve(brain));
}

// Suite names = directories under evals/ that contain a suite.json. A stray
// directory without one is not a suite and is ignored rather than reported —
// it may be scratch space next to real suites.
export function listSuiteNames(brain) {
  const dir = evalsDir(brain);
  if (!fs.existsSync(dir)) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "suite.json")))
    .map((e) => e.name)
    .sort();
}

// Returns null when valid, else a precise message naming the bad field —
// same contract as validateVerifyShape in bin/brain.js.
export function validateSuiteShape(parsed) {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "suite.json must be a JSON object";
  if (typeof parsed.kind !== "string" || !EVAL_KINDS.includes(parsed.kind))
    return `"kind" must be one of ${EVAL_KINDS.join("|")}`;
  if (typeof parsed.runner !== "string" || !parsed.runner.trim())
    return `"runner" must be a non-empty shell command (a suite nobody can run is a doc, not a suite)`;
  if (parsed.adapter !== undefined && !EVAL_ADAPTERS.includes(parsed.adapter))
    return `"adapter" must be one of ${EVAL_ADAPTERS.join("|")}`;
  if (parsed.timeout !== undefined && (typeof parsed.timeout !== "number" || !Number.isFinite(parsed.timeout) || parsed.timeout <= 0))
    return `"timeout" must be a positive number (seconds)`;
  if (parsed.max_output_chars !== undefined && (typeof parsed.max_output_chars !== "number" || parsed.max_output_chars <= 0))
    return `"max_output_chars" must be a positive number`;
  if (parsed.prompts !== undefined) {
    if (!Array.isArray(parsed.prompts)) return `"prompts" must be an array`;
    for (let i = 0; i < parsed.prompts.length; i++) {
      const p = parsed.prompts[i];
      if (typeof p !== "object" || p === null || Array.isArray(p)) return `prompts[${i}] must be an object`;
      if (typeof p.path !== "string" || !p.path.trim()) return `prompts[${i}].path must be a non-empty repo-relative path`;
    }
  }
  if (parsed.thresholds !== undefined) {
    const t = parsed.thresholds;
    if (typeof t !== "object" || t === null || Array.isArray(t)) return `"thresholds" must be an object`;
    for (const key of ["min_pass_rate", "aggregate_tolerance"]) {
      if (t[key] !== undefined && (typeof t[key] !== "number" || !Number.isFinite(t[key])))
        return `thresholds.${key} must be a number`;
    }
  }
  return null;
}

function readJsonl(file) {
  const rows = [];
  const errors = [];
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { rows, errors: [`could not read ${path.basename(file)} (${e.message})`] };
  }
  raw.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch (e) {
      errors.push(`${path.basename(file)}:${i + 1} is not valid JSON (${e.message})`);
    }
  });
  return { rows, errors };
}

// Golden set. Case-level validation is deliberately strict about the two
// fields everything downstream depends on (unique id, an input to feed) and
// lenient about the rest — `expected` is free-form by design (an assertion
// string, a schema, a label), and a case with no expectation is still a valid
// smoke case.
export function loadCases(brain, name) {
  const file = path.join(suiteDir(brain, name), "cases.jsonl");
  if (!fs.existsSync(file)) return { cases: [], errors: [`missing ${name}/cases.jsonl`] };
  const { rows, errors } = readJsonl(file);
  const seen = new Set();
  const cases = [];
  rows.forEach((c, i) => {
    const at = `${name}/cases.jsonl:${i + 1}`;
    if (typeof c !== "object" || c === null || Array.isArray(c)) {
      errors.push(`${at} must be a JSON object`);
      return;
    }
    if (typeof c.id !== "string" || !c.id.trim()) {
      errors.push(`${at} needs a non-empty string "id"`);
      return;
    }
    if (seen.has(c.id)) {
      errors.push(`${at} duplicate case id "${c.id}"`);
      return;
    }
    seen.add(c.id);
    if (c.input === undefined) errors.push(`${at} case "${c.id}" has no "input"`);
    if (c.origin !== undefined && !CASE_ORIGINS.includes(c.origin))
      errors.push(`${at} case "${c.id}" origin must be one of ${CASE_ORIGINS.join("|")}`);
    cases.push({ origin: "real", frozen: false, tags: [], ...c });
  });
  return { cases, errors };
}

// Run history, oldest first (append order). Each row summarizes one run;
// `run_file` points at the full per-case record under runs/.
export function loadRuns(brain, name) {
  const file = path.join(suiteDir(brain, name), "runs.jsonl");
  if (!fs.existsSync(file)) return { runs: [], errors: [] };
  const { rows, errors } = readJsonl(file);
  const runs = [];
  rows.forEach((r, i) => {
    const at = `${name}/runs.jsonl:${i + 1}`;
    if (typeof r !== "object" || r === null || Array.isArray(r)) {
      errors.push(`${at} must be a JSON object`);
      return;
    }
    if (typeof r.ts !== "string" || !r.ts.trim()) errors.push(`${at} needs a string "ts"`);
    runs.push(r);
  });
  return { runs, errors };
}

// One suite, fully loaded. `error` is set only when the suite itself is
// unreadable/invalid (nothing downstream can proceed); per-case and per-run
// problems ride along in `errors` so a suite with one bad line still lists.
export function loadSuite(brain, name) {
  const dir = suiteDir(brain, name);
  const file = path.join(dir, "suite.json");
  if (!fs.existsSync(file)) return { suite: null, cases: [], runs: [], errors: [], error: `no suite "${name}" in ${path.relative(process.cwd(), evalsDir(brain))}` };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return { suite: null, cases: [], runs: [], errors: [], error: `${name}/suite.json is not valid JSON (${e.message})` };
  }
  const shapeError = validateSuiteShape(parsed);
  if (shapeError) return { suite: null, cases: [], runs: [], errors: [], error: `${name}/suite.json: ${shapeError}` };
  const { cases, errors: caseErrors } = loadCases(brain, name);
  const { runs, errors: runErrors } = loadRuns(brain, name);
  return {
    suite: { name, adapter: "envelope", thresholds: {}, prompts: [], ...parsed },
    cases,
    runs,
    errors: [...caseErrors, ...runErrors],
    error: null,
  };
}

export function lastRun(runs) {
  return runs.length ? runs[runs.length - 1] : null;
}

// Aggregate score of a run, preferring an explicit `score` and falling back to
// the pass rate. Returns null when neither is derivable — an unknown score is
// reported as unknown, never as zero.
export function runScore(run) {
  if (!run) return null;
  if (typeof run.score === "number" && Number.isFinite(run.score)) return run.score;
  if (typeof run.pass === "number" && typeof run.total === "number" && run.total > 0) return run.pass / run.total;
  return null;
}

export function formatScore(score) {
  return score === null || score === undefined ? "" : score.toFixed(3);
}

// A suite is STALE when a prompt it points at was modified after the last run
// — the number on screen no longer describes the prompt on disk. Missing
// pointers are handled by evalChecks, not here.
export function isStale(brain, suite, run) {
  if (!run || !run.ts) return false;
  const runTime = Date.parse(run.ts);
  if (Number.isNaN(runTime)) return false;
  const root = repoRoot(brain);
  for (const p of suite.prompts || []) {
    const abs = path.resolve(root, p.path);
    try {
      if (fs.statSync(abs).mtimeMs > runTime) return true;
    } catch {
      // Unresolvable pointer — evalChecks reports it; not staleness.
    }
  }
  return false;
}

// One row per suite for `brain evals`. Keeps the shape flat and TOON-friendly.
export function suiteRows(brain) {
  return listSuiteNames(brain).map((name) => {
    const { suite, cases, runs, error } = loadSuite(brain, name);
    if (error) return { suite: name, kind: "?", cases: 0, frozen: 0, last_run: "", score: "", state: "invalid" };
    const run = lastRun(runs);
    const prev = runs.length > 1 ? runs[runs.length - 2] : null;
    const score = runScore(run);
    const prevScore = runScore(prev);
    let state = "ok";
    if (!run) state = "never-run";
    else if (isStale(brain, suite, run)) state = "stale";
    else if (score !== null && prevScore !== null && score < prevScore) state = "regressed";
    return {
      suite: name,
      kind: suite.kind,
      cases: cases.length,
      frozen: cases.filter((c) => c.frozen).length,
      last_run: run ? run.ts : "",
      score: formatScore(score),
      state,
    };
  });
}

// ---------------------------------------------------------------------------
// Adapters — vendor output -> the run envelope
// ---------------------------------------------------------------------------
//
// An adapter is a pure JSON normalizer. Brain never imports a vendor SDK; it
// reads the file the tool already wrote. Returns { cases, usage, error } —
// `error` set means nothing gets recorded (a half-parsed run is worse than no
// run, because it looks like evidence).

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function normalizeEnvelope(parsed) {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return { error: "envelope must be a JSON object with a \"cases\" array" };
  if (!Array.isArray(parsed.cases)) return { error: `envelope is missing the "cases" array` };
  const cases = [];
  for (let i = 0; i < parsed.cases.length; i++) {
    const c = parsed.cases[i];
    if (typeof c !== "object" || c === null || Array.isArray(c)) return { error: `cases[${i}] must be an object` };
    if (typeof c.id !== "string" || !c.id.trim()) return { error: `cases[${i}] needs a string "id"` };
    if (typeof c.pass !== "boolean" && num(c.score) === undefined)
      return { error: `cases[${i}] ("${c.id}") needs a boolean "pass" or a numeric "score"` };
    cases.push({
      id: c.id,
      output: c.output === undefined ? "" : String(c.output),
      pass: typeof c.pass === "boolean" ? c.pass : num(c.score) >= 1,
      score: num(c.score),
      notes: c.notes === undefined ? "" : String(c.notes),
      trace_url: c.trace_url,
      usage: c.usage,
    });
  }
  return { cases, usage: parsed.usage };
}

// promptfoo `eval -o out.json`. Deliberately defensive about field names:
// promptfoo's shape has moved across majors, and a vendor rename should
// produce a NAMED error (which field was missing) rather than a run of
// silently-zero scores.
function normalizePromptfoo(parsed) {
  const results = (parsed && (parsed.results?.results || parsed.results || parsed.evalResults)) || null;
  if (!Array.isArray(results))
    return { error: `promptfoo output has no "results" array (looked at results, results.results, evalResults) — if this is a different tool, use --adapter envelope` };
  const cases = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i] || {};
    const vars = r.vars || r.testCase?.vars || {};
    const id = vars.id || vars.case_id || vars.__case_id || r.id || r.description || r.testCase?.description || `case-${i + 1}`;
    const pass = typeof r.success === "boolean" ? r.success : r.pass;
    const score = num(r.score);
    if (typeof pass !== "boolean" && score === undefined)
      return { error: `promptfoo results[${i}] has neither "success" nor a numeric "score"` };
    const output = r.response?.output ?? r.output ?? "";
    cases.push({
      id: String(id),
      output: typeof output === "string" ? output : JSON.stringify(output),
      pass: typeof pass === "boolean" ? pass : score >= 1,
      score,
      notes: (r.gradingResult && r.gradingResult.reason) || r.error || "",
      trace_url: r.traceUrl || r.trace_url,
    });
  }
  const tokens = parsed.stats?.tokenUsage?.total;
  const cost = parsed.stats?.cost ?? parsed.stats?.tokenUsage?.cost;
  const usage = tokens === undefined && cost === undefined ? undefined : { tokens, cost_usd: cost };
  return { cases, usage };
}

export function adaptRunOutput(raw, adapter = "envelope") {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { error: `adapter "${adapter}": output is not valid JSON (${e.message})` };
  }
  if (adapter === "promptfoo") return normalizePromptfoo(parsed);
  if (adapter === "envelope") return normalizeEnvelope(parsed);
  return { error: `unknown adapter "${adapter}" (valid: ${EVAL_ADAPTERS.join(", ")})` };
}

// ---------------------------------------------------------------------------
// Scoring, recording, and the gate
// ---------------------------------------------------------------------------

// Joins adapter output to the golden set. Cases the runner never reported are
// counted as failures (silence is not a pass); cases the runner invented are
// reported as `unknown` and mark the run partial.
export function scoreRun(cases, resultCases) {
  const byId = new Map(resultCases.map((r) => [r.id, r]));
  const scored = [];
  const unknown = [];
  for (const r of resultCases) if (!cases.some((c) => c.id === r.id)) unknown.push(r.id);
  for (const c of cases) {
    const r = byId.get(c.id);
    if (!r) {
      scored.push({ id: c.id, frozen: !!c.frozen, pass: false, score: 0, output: "", notes: "not reported by the runner", missing: true });
      continue;
    }
    scored.push({
      id: c.id,
      frozen: !!c.frozen,
      pass: r.pass,
      score: r.score === undefined ? (r.pass ? 1 : 0) : r.score,
      output: r.output,
      notes: r.notes,
      trace_url: r.trace_url,
      missing: false,
    });
  }
  const total = scored.length;
  const pass = scored.filter((s) => s.pass).length;
  const score = total ? scored.reduce((a, s) => a + s.score, 0) / total : null;
  return {
    scored,
    unknown,
    summary: {
      pass,
      total,
      score,
      failing: scored.filter((s) => !s.pass).map((s) => s.id),
      frozen_failing: scored.filter((s) => !s.pass && s.frozen).map((s) => s.id),
      partial: unknown.length > 0,
    },
  };
}

// Truncates per-case output for the committed run file. Frozen cases keep
// their full output — those are the ones anyone will actually re-read.
function truncateOutput(scored, maxChars) {
  if (!maxChars) return scored;
  return scored.map((s) =>
    s.frozen || typeof s.output !== "string" || s.output.length <= maxChars
      ? s
      : { ...s, output: s.output.slice(0, maxChars) + `\n… (truncated, ${s.output.length} chars total)` }
  );
}

// Writes runs/<ts>.json + appends one summary line to runs.jsonl. Returns the
// summary row that was appended.
export function recordRun(brain, name, { suite, scored, summary, usage, ts, branch, commit, unknown }) {
  const dir = suiteDir(brain, name);
  const runsDir = path.join(dir, "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const safeTs = ts.replace(/[:.]/g, "-");
  const runFile = path.join("runs", `${safeTs}.json`);
  fs.writeFileSync(
    path.join(dir, runFile),
    JSON.stringify(
      {
        ts,
        suite: name,
        branch,
        commit,
        runner: suite.runner,
        adapter: suite.adapter,
        model: suite.model,
        summary,
        unknown_case_ids: unknown,
        cases: truncateOutput(scored, suite.max_output_chars),
      },
      null,
      2
    ) + "\n"
  );
  const row = {
    ts,
    branch,
    commit,
    pass: summary.pass,
    total: summary.total,
    score: summary.score,
    failing: summary.failing,
    frozen_failing: summary.frozen_failing,
    partial: summary.partial,
    run_file: runFile,
    ...(usage ? { usage } : {}),
  };
  fs.appendFileSync(path.join(dir, "runs.jsonl"), JSON.stringify(row) + "\n");
  return row;
}

// The gate, exactly as locked in plan `ai-work-harness` decision 4: frozen
// cases are absolute, aggregates get a tolerance band. Returns
// { status: "pass"|"fail"|"baseline", reason }.
export function gateVerdict(suite, summary, prevRun) {
  if (summary.frozen_failing.length)
    return { status: "fail", reason: `frozen regression case(s) failing: ${summary.frozen_failing.join(", ")}` };
  const thresholds = suite.thresholds || {};
  const passRate = summary.total ? summary.pass / summary.total : null;
  if (thresholds.min_pass_rate !== undefined && passRate !== null && passRate < thresholds.min_pass_rate)
    return {
      status: "fail",
      reason: `pass rate ${passRate.toFixed(3)} below min_pass_rate ${thresholds.min_pass_rate} (failing: ${summary.failing.join(", ") || "none"})`,
    };
  const prevScore = runScore(prevRun);
  const score = summary.score;
  if (prevScore === null || prevScore === undefined || score === null)
    return { status: "baseline", reason: "no comparable prior run — baseline established" };
  const tolerance = thresholds.aggregate_tolerance === undefined ? 0.02 : thresholds.aggregate_tolerance;
  if (score < prevScore - tolerance)
    return {
      status: "fail",
      reason: `aggregate ${score.toFixed(3)} below prior ${prevScore.toFixed(3)} beyond tolerance ${tolerance}`,
    };
  return { status: "pass", reason: `aggregate ${score.toFixed(3)} vs prior ${prevScore.toFixed(3)} (tolerance ${tolerance})` };
}

// Appends one case to the golden set. Refuses a duplicate id — a silently
// overwritten case is a lost regression test.
export function appendCase(brain, name, entry) {
  const { cases } = loadCases(brain, name);
  if (cases.some((c) => c.id === entry.id)) return { error: `case id "${entry.id}" already exists in ${name}` };
  const file = path.join(suiteDir(brain, name), "cases.jsonl");
  fs.appendFileSync(file, JSON.stringify(entry) + "\n");
  return { error: null, entry };
}

// Flips an existing case to frozen — the "I fixed a bug, encode it" move.
// Rewrites the file in place, preserving order and every other field.
export function freezeCase(brain, name, id, frozen = true) {
  const file = path.join(suiteDir(brain, name), "cases.jsonl");
  if (!fs.existsSync(file)) return { error: `missing ${name}/cases.jsonl` };
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let found = null;
  const out = lines.map((line) => {
    if (!line.trim()) return line;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return line;
    }
    if (obj.id !== id) return line;
    found = { ...obj, frozen };
    return JSON.stringify(found);
  });
  if (!found) return { error: `no case "${id}" in ${name}` };
  fs.writeFileSync(file, out.join("\n"));
  return { error: null, entry: found };
}

// Deterministic invariants over the evals subsystem, folded into `brain check`.
// Returns [] when the repo has no evals/ at all — the subsystem is optional and
// its absence is not a failure.
export function evalChecks(brain) {
  if (!fs.existsSync(evalsDir(brain))) return [];
  const names = listSuiteNames(brain);
  const checks = [];

  const suiteBad = [];
  const dataBad = [];
  const danglingPrompts = [];
  const missingRunFiles = [];
  let caseCount = 0;
  let runCount = 0;

  for (const name of names) {
    const { suite, cases, runs, errors, error } = loadSuite(brain, name);
    if (error) {
      suiteBad.push(error);
      continue;
    }
    caseCount += cases.length;
    runCount += runs.length;
    dataBad.push(...errors);
    for (const p of suite.prompts || []) {
      if (!fs.existsSync(path.resolve(repoRoot(brain), p.path))) danglingPrompts.push(`${name} -> ${p.path}`);
    }
    for (const r of runs) {
      if (r.run_file && !fs.existsSync(path.resolve(suiteDir(brain, name), r.run_file)))
        missingRunFiles.push(`${name}/${r.run_file}`);
    }
  }

  checks.push({
    check: "eval suite.json files parse",
    status: suiteBad.length ? "fail" : "pass",
    detail: suiteBad.length ? suiteBad.join("; ") : `${names.length} suite(s) checked`,
  });
  checks.push({
    check: "eval cases + runs parse (ids unique)",
    status: dataBad.length ? "fail" : "pass",
    detail: dataBad.length ? dataBad.join("; ") : `${caseCount} case(s), ${runCount} run(s) checked`,
  });
  checks.push({
    check: "eval prompt pointers resolve",
    status: danglingPrompts.length ? "fail" : "pass",
    detail: danglingPrompts.length ? `dangling: ${danglingPrompts.join(", ")}` : "all prompt pointers resolve",
  });
  checks.push({
    check: "eval run files exist",
    status: missingRunFiles.length ? "fail" : "pass",
    detail: missingRunFiles.length ? `missing: ${missingRunFiles.join(", ")}` : `${runCount} run record(s) checked`,
  });
  return checks;
}
