#!/usr/bin/env node
// scripts/eval-skill-coverage.mjs — the runner for the `skill-coverage` eval
// suite (evals/skill-coverage/). Repo-dev tooling for brain-axi itself, run
// standalone: deterministic string assertions over the skills/ tree, no model
// call, no deps, no brain command.
//
//   node scripts/eval-skill-coverage.mjs            print the run envelope
//   node scripts/eval-skill-coverage.mjs --record   also append the run record to
//                                                   evals/skill-coverage/ (exit 1
//                                                   if a frozen case fails or the
//                                                   score is under min_pass_rate)
//
// Envelope: ONE JSON object on stdout, {"cases":[{id, output, pass, score,
// notes}], "usage": {...}}. Without --record, exit 0 when the run completed
// (a failing CASE is a result, not a runner error).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordRun } from "./eval-record.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suiteDir = path.join(repoRoot, "evals", "skill-coverage");
const skillsDir = path.join(repoRoot, "skills");

function fail(message) {
  process.stderr.write(`eval-skill-coverage: ${message}\n`);
  process.exit(1);
}

// The prompt under test is the WHOLE skills/ tree: the router plus every
// brain-* phase skill and each skill's references/. Concatenated in sorted
// path order, so one document answers "does the skill system say X anywhere".
function skillFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...skillFiles(p));
    else if (!e.name.startsWith(".")) out.push(p);
  }
  return out;
}

if (!fs.existsSync(skillsDir)) fail("missing skills/ — the agent skill tree is the prompt under test");
if (!fs.existsSync(path.join(suiteDir, "cases.jsonl"))) fail("missing cases.jsonl");

// Markdown wraps; meaning does not. Collapsing whitespace stops a soft line
// break inside `brain verify --stage baseline` from reading as a missing
// contract — a false negative that would train everyone to ignore this suite.
const skill = skillFiles(skillsDir).map((f) => fs.readFileSync(f, "utf8")).join("\n").replace(/\s+/g, " ");

let cases;
try {
  cases = fs
    .readFileSync(path.join(suiteDir, "cases.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
} catch (e) {
  fail(`cases.jsonl: ${e.message}`);
}

// Needles get the same whitespace collapse as the haystack, and match with
// letter/digit boundaries on both ends: plain substring matching makes a
// short command name pass inside a longer one ("brain view" inside "brain
// views", say) — exactly the silent skill drift this suite exists to catch.
// (Not \b: needles may start with a flag like "--stage", where \b would
// never match.)
const norm = (s) => String(s).replace(/\s+/g, " ");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (needle) => new RegExp(`(?<![A-Za-z0-9])${escapeRe(norm(needle))}(?![A-Za-z0-9])`).test(skill);

// One assertion type per case. Kept tiny on purpose: an assertion language
// that grows features is a runner that needs its own tests.
function evaluate(c) {
  const a = c.assert || {};
  if (a.type === "contains") {
    const hit = mentions(a.value);
    return {
      pass: hit,
      output: hit ? `found: ${a.value}` : `NOT FOUND: ${a.value}`,
      notes: hit ? "" : `the skills/ tree never mentions "${a.value}" — add it to the router (skills/brain/SKILL.md) or the owning phase skill`,
    };
  }
  // Command coverage: the skill may name a command in either invocation form
  // (`brain features` or `npx -y brain-axi features`). Either one makes the
  // command reachable, which is what the case actually asserts.
  if (a.type === "contains_any") {
    const values = a.values || [];
    const hit = values.find((v) => mentions(v));
    return {
      pass: !!hit,
      output: hit ? `found: ${hit}` : `NOT FOUND (any of): ${values.join(" | ")}`,
      notes: hit ? "" : `the skills/ tree names this command in no invocation form — add it to the router (skills/brain/SKILL.md)`,
    };
  }
  if (a.type === "not_contains") {
    const hit = mentions(a.value);
    return {
      pass: !hit,
      output: hit ? `PRESENT (must not be): ${a.value}` : `absent as required: ${a.value}`,
      notes: hit ? `the skills/ tree references "${a.value}", which does not exist in this repo` : "",
    };
  }
  return { pass: false, output: "", notes: `unknown assert type "${a.type}"` };
}

const results = cases.map((c) => {
  const r = evaluate(c);
  return { id: c.id, output: r.output, pass: r.pass, score: r.pass ? 1 : 0, notes: r.notes };
});

const envelope = { cases: results, usage: { tokens: 0, cost_usd: 0 } };
process.stdout.write(JSON.stringify(envelope) + "\n");

if (process.argv.includes("--record")) {
  const { summary, gateFailed, runFile } = recordRun(repoRoot, suiteDir, envelope);
  process.stderr.write(
    `eval-skill-coverage: ${summary.pass}/${summary.total} pass; frozen failing: ${summary.frozen_failing.join(", ") || "none"}; recorded ${runFile}\n`
  );
  if (gateFailed) process.exitCode = 1;
}
