// scripts/eval-record.mjs — repo-dev helper shared by the eval-skill-*.mjs
// runners: score an envelope against its suite and append the run record to
// evals/<suite>/ (runs/<ts>.json in full + one runs.jsonl summary row).
// Evals are repo-dev tooling for brain-axi itself; the CLI knows nothing of them.
// Run records are history: this only ever ADDS files, never rewrites or deletes.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const git = (root, args) => {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};

const readJsonl = (f) =>
  fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];

// envelope: {cases:[{id, pass, score, output, notes}], usage}
// Returns {summary, gateFailed, gateReason, runFile}. gateFailed = a frozen
// case failed, the score is below the suite's min_pass_rate, or it dropped
// more than thresholds.aggregate_tolerance (default 0.02) below the previous
// recorded run.
export function recordRun(root, suiteDir, envelope) {
  const suite = JSON.parse(fs.readFileSync(path.join(suiteDir, "suite.json"), "utf8"));
  const golden = [...readJsonl(path.join(suiteDir, "cases.jsonl"))];
  const byId = new Map(golden.map((c) => [c.id, c]));
  const cap = suite.max_output_chars || 4000;
  const got = new Map((envelope.cases || []).map((c) => [c.id, c]));
  const cases = golden.map((g) => {
    const c = got.get(g.id);
    if (!c) return { id: g.id, frozen: !!g.frozen, pass: false, score: 0, output: "", notes: "missing from the runner output", missing: true };
    return { id: g.id, frozen: !!g.frozen, pass: !!c.pass, score: c.score ?? (c.pass ? 1 : 0), output: String(c.output ?? "").slice(0, cap), notes: c.notes || "", missing: false };
  });
  const failing = cases.filter((c) => !c.pass).map((c) => c.id);
  const frozenFailing = cases.filter((c) => !c.pass && c.frozen).map((c) => c.id);
  const total = cases.length;
  const pass = total - failing.length;
  const score = total ? pass / total : 0;
  const ts = new Date().toISOString();
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const commit = git(root, ["rev-parse", "--short", "HEAD"]);
  const partial = cases.some((c) => c.missing);
  const summary = { pass, total, score, failing, frozen_failing: frozenFailing, partial };
  const runFile = `runs/${ts.replace(/[:.]/g, "-")}.json`;
  const full = {
    ts,
    suite: path.basename(suiteDir),
    branch,
    commit,
    runner: suite.runner,
    adapter: suite.adapter,
    model: suite.model,
    summary,
    unknown_case_ids: [...got.keys()].filter((id) => !byId.has(id)),
    cases,
  };
  const prev = readJsonl(path.join(suiteDir, "runs.jsonl")).at(-1);
  const prevScore = prev && typeof prev.score === "number" && Number.isFinite(prev.score) ? prev.score : null;
  fs.mkdirSync(path.join(suiteDir, "runs"), { recursive: true });
  fs.writeFileSync(path.join(suiteDir, runFile), JSON.stringify(full, null, 2) + "\n", { flag: "wx" });
  fs.appendFileSync(
    path.join(suiteDir, "runs.jsonl"),
    JSON.stringify({ ts, branch, commit, ...summary, run_file: runFile, usage: envelope.usage || {} }) + "\n"
  );
  const min = suite.thresholds?.min_pass_rate ?? 1;
  const tolerance = suite.thresholds?.aggregate_tolerance ?? 0.02;
  let gateReason = null;
  if (frozenFailing.length) gateReason = `frozen case(s) failing: ${frozenFailing.join(", ")}`;
  else if (score < min) gateReason = `score ${score.toFixed(3)} below min_pass_rate ${min}`;
  else if (prevScore !== null && score < prevScore - tolerance)
    gateReason = `score ${score.toFixed(3)} dropped below the previous run's ${prevScore.toFixed(3)} beyond aggregate_tolerance ${tolerance}`;
  return { summary, gateFailed: gateReason !== null, gateReason, runFile };
}
