#!/usr/bin/env node
// scripts/eval-skill-routing.mjs — runner + converter for the `skill-routing`
// eval suite (does the right brain-* skill fire first for a given prompt?).
//
// The engine is the built-in `claude plugin eval`; this file only (a) turns the
// suite's golden set into the case dirs that tool reads, and (b) turns the
// tool's aggregate-result JSON into the run envelope. Repo-dev tooling for
// brain-axi itself, run standalone (no brain command involved).
//
//   gen                      evals/skill-routing/{cases,heldout}.jsonl -> evals-plugin/<id>/{prompt.md,case.yaml}
//   convert <result.json>    aggregate-result.json -> run envelope on stdout
//        [--heldout-out f]   also append the split summary row (held-out + baseline arm) to f
//        [--rescored-from ts] label the output as a re-grade of an earlier run (no new model calls)
//        [--record]          also append the run record to evals/skill-routing/ (runs/<ts>.json + runs.jsonl)
//   live                     gen + run `claude plugin eval` (spends credential: ~2 child runs per case,
//                            ~$7 per run) + convert; appends split-runs.jsonl and the run record
//
// The scaffold for every case with a brain (evals-plugin/scaffold-brain.sh) is a
// fresh `brain init` in a new git repo — the CLI makes the brain, no fixture.
//
// First-skill grading: the tool's per-case result records only WHICH brain skills
// fired (the `fired-*` graders), not their order (traces are temp files). So
// `convert` grades the with-plugin arm itself from the fired set: positive cases
// pass only if every brain-* skill that fired is acceptable (then the first one is
// too); a case where several distinct skills fired and any is unacceptable fails,
// since the first cannot be shown to be right. `none` cases pass if nothing outside
// the allowed set fired. Single-skill outcomes (the usual case) are exact.
//
// Held-out cases live in heldout.jsonl, are run with everything else, and are
// reported in the split summary, but are NOT in the envelope: the brain gate
// (min_pass_rate) is defined on non-held-out cases only.
//
// Expected-skill grammar (cases `expected`): "brain-grill"; alternatives with
// "|" ("brain-ux|brain-product"); "none" = no brain-* skill may fire; "none|X"
// = nothing except X may fire (X optional).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { recordRun } from "./eval-record.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suiteDir = path.join(root, "evals", "skill-routing");
const evalDir = path.join(root, "evals-plugin");
const SKILLS = ["brain", "brain-ai", "brain-done", "brain-execute", "brain-grill", "brain-plan", "brain-product", "brain-start", "brain-ux", "brain-verify", "brain-write"];
const MAX_TURNS = 3;

const die = (m, code = 1) => { process.stderr.write(`eval-skill-routing: ${m}\n`); process.exit(code); };
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
const loadAll = () => [...readJsonl(path.join(suiteDir, "cases.jsonl")), ...readJsonl(path.join(suiteDir, "heldout.jsonl"))];
const skillRe = (names) => `"skill":\\s*"(?:[\\w-]+:)?(?:${names.join("|")})"`;
const q = (s) => `'${s.replace(/'/g, "''")}'`; // YAML single-quoted scalar

function parseExpected(expected) {
  const parts = expected.split("|").map((s) => s.trim());
  const none = parts.includes("none");
  const accept = parts.filter((p) => p !== "none");
  return { none, accept };
}

function gen() {
  const cases = loadAll();
  if (!cases.length) die("no cases in evals/skill-routing/{cases,heldout}.jsonl");
  fs.mkdirSync(evalDir, { recursive: true });
  for (const c of cases) {
    const { none, accept } = parseExpected(c.expected);
    const noBrain = c.tags.includes("no-brain");
    const graders = [];
    if (!none) {
      graders.push(`  - name: routed-to-expected\n    type: tool_used\n    tool: Skill\n    input_match: ${q(skillRe(accept))}\n    min: 1\n    arm: both\n    weight: 1`);
    } else {
      const forbidden = SKILLS.filter((s) => !accept.includes(s));
      graders.push(`  - name: no-unexpected-brain-skill\n    type: tool_used\n    tool: Skill\n    input_match: ${q(skillRe(forbidden))}\n    min: 0\n    max: 0\n    arm: both\n    weight: 1`);
    }
    for (const s of SKILLS) {
      graders.push(`  - name: fired-${s}\n    type: tool_used\n    tool: Skill\n    input_match: ${q(skillRe([s]))}\n    arm: with-only`);
    }
    const band = c.tags[0];
    const yaml = [
      `schema_version: "1.1"`,
      `name: ${c.id}`,
      `description: ${q(`[${band}] expected first skill: ${c.expected}. ${c.note || ""}`.trim())}`,
      `tags: [${c.tags.join(", ")}]`,
      `runs: 1`,
      `execution:`,
      `  max_turns: ${MAX_TURNS}`,
      `  allowed_tools: [Read, Glob, Grep, Skill]`,
      ...(noBrain ? [] : [`context:`, `  scaffold_script: fixture.sh`]),
      `graders:`,
      ...graders,
      ``,
    ].join("\n");
    const dir = path.join(evalDir, c.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "case.yaml"), yaml);
    if (!noBrain) fs.writeFileSync(path.join(dir, "fixture.sh"), '#!/bin/bash\n# The tool only accepts scaffold scripts inside the case dir; the shared scaffold lives one level up.\nexec bash "$(cd "$(dirname "$0")" && pwd)/../scaffold-brain.sh"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "prompt.md"), `---\nname: ${c.id}\n---\n\n${c.input}\n`);
  }
  return cases.length;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function convert(file, heldoutOut, rescoreNote = "") {
  const agg = JSON.parse(fs.readFileSync(file, "utf8"));
  const heldIds = new Set(readJsonl(path.join(suiteDir, "heldout.jsonl")).map((c) => c.id));
  const known = new Map(loadAll().map((c) => [c.id, c]));
  const envelope = [];
  const split = { core: { with: [], without: [] }, held: { with: [], without: [] } };
  let cost = 0;
  for (const c of agg.cases || []) {
    const spec = known.get(c.name);
    if (!spec) continue;
    const runsWith = c.arms?.with || [];
    const runsWithout = c.arms?.without || [];
    for (const r of [...runsWith, ...runsWithout]) {
      cost += r.costUsd || 0;
    }
    const bucket = heldIds.has(c.name) ? split.held : split.core;
    // The turn cap is by design (we only grade the routing tool call), so hitting it is not an error.
    const realError = (r) => (r?.error && !/maximum number of turns/i.test(r.error) ? r.error : null);
    const fired = (r) => (r?.graders || []).filter((g) => g.name?.startsWith("fired-") && g.passed).map((g) => g.name.slice(6));
    const w = runsWith[0];
    const wo = runsWithout[0];
    // Baseline arm has no fired-* data (with-only graders): keep the tool's own score.
    const passBase = (r) => (r && !realError(r) && r.score >= 1 ? 1 : 0);
    const { none, accept } = parseExpected(spec.expected);
    const wf = fired(w);
    const pass = (r) => (r && !realError(r) && wf.every((s) => accept.includes(s)) && (none || wf.length > 0) ? 1 : 0);
    bucket.with.push(pass(w));
    bucket.without.push(passBase(wo));
    const err = realError(w);
    if (!heldIds.has(c.name)) {
      envelope.push({
        id: c.name,
        pass: !!pass(w),
        score: pass(w),
        output: err ? `ERROR: ${err}` : `fired: ${fired(w).join(", ") || "(no brain-* skill)"}`,
        notes: `${rescoreNote}expected ${spec.expected}; baseline arm (no plugin) ${passBase(wo) ? "passed" : "failed"}${fired(wo).length ? `, fired ${fired(wo).join(",")}` : ""}`,
      });
    }
  }
  const sum = (b) => ({ n: b.with.length, with: mean(b.with), without: mean(b.without) });
  const core = sum(split.core);
  const held = sum(split.held);
  const row = {
    ts: new Date().toISOString(),
    source: path.basename(path.dirname(file)),
    ...(rescoreNote ? { note: rescoreNote.trim() } : {}),
    non_held_out: { ...core, delta: core.with !== null ? core.with - core.without : null },
    held_out: { ...held, delta: held.with !== null ? held.with - held.without : null },
    usage: { cost_usd: Number(cost.toFixed(4)) },
    claude_version: agg.claudeVersion,
  };
  if (heldoutOut) fs.appendFileSync(heldoutOut, JSON.stringify(row) + "\n");
  return { cases: envelope, usage: { cost_usd: Number(cost.toFixed(4)) }, split: row };
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "gen") {
  process.stdout.write(`generated ${gen()} cases in evals-plugin/\n`);
} else if (cmd === "convert") {
  const file = rest.find((a) => !a.startsWith("--"));
  if (!file) die("usage: convert <aggregate-result.json> [--heldout-out file]");
  const i = rest.indexOf("--heldout-out");
  const j = rest.indexOf("--rescored-from");
  const env = convert(file, i >= 0 ? rest[i + 1] : null, j >= 0 ? `rescored from ${rest[j + 1]}: first-skill grading, same raw data; ` : "");
  process.stdout.write(JSON.stringify({ cases: env.cases, usage: env.usage }) + "\n");
  process.stderr.write(`split: ${JSON.stringify(env.split)}\n`);
  if (rest.includes("--record")) record(env);
} else if (cmd === "live") {
  gen();
  // Run against a staged copy holding only the plugin's own files: the tool loads
  // every top-level entry of the plugin dir, and a stray odd-named directory in a
  // working checkout (e.g. one containing "#", "(" or a newline) makes it refuse to load.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "brain-plugin-stage-"));
  for (const e of [".claude-plugin", "skills", "hooks", "bin", "lib", "package.json", "evals-plugin"]) {
    fs.cpSync(path.join(root, e), path.join(stage, e), { recursive: true, filter: (src) => !src.includes(`${path.sep}results`) });
  }
  const out = path.join(evalDir, "results", `live-${Date.now()}`);
  fs.mkdirSync(out, { recursive: true });
  const jsonFile = path.join(out, "aggregate-result.json");
  let r;
  try {
    r = spawnSync("claude", ["plugin", "eval", stage, "--eval-dir", "evals-plugin", "--scaffold", "--ablation", "with-without", "--runs", "1", "-j", "4", "--threshold", "0", "--trust-plugin", "--no-publish", "--json", jsonFile], { cwd: stage, stdio: ["ignore", "ignore", "inherit"] });
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  if (r.status !== 0 || !fs.existsSync(jsonFile)) die(`claude plugin eval failed (exit ${r.status})`);
  const env = convert(jsonFile, path.join(suiteDir, "split-runs.jsonl"));
  process.stdout.write(JSON.stringify({ cases: env.cases, usage: env.usage }) + "\n");
  record(env);
} else {
  die("usage: eval-skill-routing.mjs gen | convert <aggregate-result.json> [--heldout-out f] [--rescored-from ts] [--record] | live");
}

// Append the run record (runs/<ts>.json + runs.jsonl); exit 1 when the gate
// (frozen cases, min_pass_rate) fails.
function record(env) {
  const { summary, gateFailed, runFile } = recordRun(root, suiteDir, { cases: env.cases, usage: env.usage });
  process.stderr.write(`eval-skill-routing: ${summary.pass}/${summary.total} pass; frozen failing: ${summary.frozen_failing.join(", ") || "none"}; recorded ${runFile}\n`);
  if (gateFailed) process.exitCode = 1;
}
