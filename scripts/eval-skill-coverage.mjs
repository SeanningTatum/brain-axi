#!/usr/bin/env node
// scripts/eval-skill-coverage.mjs — the runner for the `skill-coverage` eval
// suite. This is the reference implementation of the runner contract that
// `brain evals run` expects, and deliberately the simplest possible one:
// deterministic string assertions over a document, no model call, no deps.
//
// Contract (see `brain playbook ai` and .brain/rules/ai-work.md):
//   - read the golden set from the suite directory
//   - print ONE JSON envelope on stdout: {"cases":[{id, output, pass, score,
//     notes}], "usage": {...}}
//   - exit 0 when the run completed, non-zero only when the run itself could
//     not be performed (a failing CASE is a result, not a runner error)
//
// Any project can swap this for promptfoo, a python harness, or an agent —
// the envelope is the only thing brain reads.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suiteDir = path.join(repoRoot, ".brain", "evals", "skill-coverage");
const skillPath = path.join(repoRoot, ".claude", "skills", "brain", "SKILL.md");

function fail(message) {
  process.stderr.write(`eval-skill-coverage: ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(skillPath)) fail(`missing ${path.relative(repoRoot, skillPath)} — run \`brain skill --write\` first`);
if (!fs.existsSync(path.join(suiteDir, "cases.jsonl"))) fail("missing cases.jsonl");

// Markdown wraps; meaning does not. Collapsing whitespace stops a soft line
// break inside `brain verify --stage baseline` from reading as a missing
// contract — a false negative that would train everyone to ignore this suite.
const skill = fs.readFileSync(skillPath, "utf8").replace(/\s+/g, " ");
const cases = fs
  .readFileSync(path.join(suiteDir, "cases.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

// One assertion type per case. Kept tiny on purpose: an assertion language
// that grows features is a runner that needs its own tests.
function evaluate(c) {
  const a = c.assert || {};
  if (a.type === "contains") {
    const hit = skill.includes(a.value);
    return {
      pass: hit,
      output: hit ? `found: ${a.value}` : `NOT FOUND: ${a.value}`,
      notes: hit ? "" : `SKILL.md never mentions "${a.value}" — regenerate with \`brain skill --write\` after updating skillContent()`,
    };
  }
  // Command coverage: the skill may name a command in either invocation form
  // (`brain features` or `npx -y brain-axi features`). Either one makes the
  // command reachable, which is what the case actually asserts.
  if (a.type === "contains_any") {
    const values = a.values || [];
    const hit = values.find((v) => skill.includes(v));
    return {
      pass: !!hit,
      output: hit ? `found: ${hit}` : `NOT FOUND (any of): ${values.join(" | ")}`,
      notes: hit ? "" : `SKILL.md names this command in no invocation form — update skillContent() then \`brain skill --write\``,
    };
  }
  if (a.type === "not_contains") {
    const hit = skill.includes(a.value);
    return {
      pass: !hit,
      output: hit ? `PRESENT (must not be): ${a.value}` : `absent as required: ${a.value}`,
      notes: hit ? `SKILL.md references "${a.value}", which does not exist in this repo` : "",
    };
  }
  return { pass: false, output: "", notes: `unknown assert type "${a.type}"` };
}

const results = cases.map((c) => {
  const r = evaluate(c);
  return { id: c.id, output: r.output, pass: r.pass, score: r.pass ? 1 : 0, notes: r.notes };
});

process.stdout.write(
  JSON.stringify({
    cases: results,
    usage: { tokens: 0, cost_usd: 0 },
  }) + "\n"
);
