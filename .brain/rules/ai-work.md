# Rule: AI-work surface (`playbook ai`, the AI branches, the evals subsystem)

_Layer: `lib/review/playbooks.js` (agent-facing standards) + `lib/review/evals.js` (eval data layer) + `cmdEvals` / `cmdVerifyEvals` / `skillContent()` in `bin/brain.js`._

Read when: editing the `ai` playbook, adding/altering an AI branch inside another playbook, or touching any part of the evals subsystem (`.brain/evals/`, `brain evals`, the `evals` verify stage).

## Code layout

| Surface | Where | Owns |
|---------|-------|------|
| Eval data layer | `lib/review/evals.js` | Suite/case/run loading + validation, adapters, `scoreRun`, `recordRun`, `gateVerdict`, `appendCase`/`freezeCase`, `evalChecks` |
| CLI verbs | `cmdEvals` in `bin/brain.js` | `evals` list/view/cases/runs/run/record/golden — TOON output + `help:` lists only |
| The gate | `cmdVerifyEvals` in `bin/brain.js` | `brain verify --stage evals`: runs every suite, records, applies `gateVerdict`, exits 1 |
| Checkpoint stamp | `cmdProgressAdd` `--eval` | Reads score/delta/frozen/cost out of the run record — never from the caller |
| Dogfood suite | `.brain/evals/skill-coverage/` + `scripts/eval-skill-coverage.mjs` | Scores the generated skill: command coverage, contracts, no fabricated tooling |

Boundaries that matter: **`evals.js` never spawns, writes prompts, or calls a model** — execution lives in `bin/brain.js`, model calls live in the project's own runner. `evals` is a stage of `brain verify` but NOT a legal stage inside `verify.json` (`VERIFY_STAGES` vs `ALL_VERIFY_STAGES`): gate logic belongs in brain, not in a shell string.

## What exists today (phases 1-3)

| Surface | Where | Contains |
|---------|-------|----------|
| `brain playbook ai` | `PLAYBOOKS.ai` in `lib/review/playbooks.js` | Full AI-work standard: prompt contract, prompting practice, golden sets, synthesis rules, eval design, the change loop, pipelines/guardrails, agent topology, human loop, anti-patterns, readiness |
| Plan §13 | `PLAYBOOKS.plan` | AI addendum — four extra plan sections + two stock decision cards (model choice, eval kind) |
| Start §3, §5 | `PLAYBOOKS.start` | Read `.brain/evals/` state; take an eval baseline before editing prompts |
| Execute step 3b | `PLAYBOOKS.execute` | Re-run the suite per prompt change; record per-case delta; a red frozen case kills the change |
| Done §2b + DoD | `PLAYBOOKS.done` | Suite re-run after the last edit, no failing frozen case, every fixed bug encoded as a frozen case, human eval feedback answered |
| Skill "AI work" | `skillContent()` in `bin/brain.js` | Same contract, condensed, plus the full `brain evals` command surface and the runner/adapter envelope |
| Verify docs | `skillContent()` verify section | `--stage evals` is the gate and is opt-in; `evals` is not a verify.json stage |

## Do

- **Keep the six surfaces above consistent.** A rule stated in `playbook ai` and contradicted (or silently missing) in `playbook done` is worse than one that lives in a single place — agents read whichever one the task routed them to.
- **Escape every backtick** (`` \` ``) and avoid `${` in playbook template literals — this module is a plain data module and must stay syntactically inert.
- **Plain text only in playbook content.** No HTML tags (`<mark>`, `<code>`); these are printed to a terminal, not rendered. Emphasis is `**bold**` and section rules are the `---...` bars.
- **Re-run `node bin/brain.js skill --check` after any playbook or skill edit**, and `skill --write` when it reports stale. The generated skill drifting from the playbooks is the one invariant CI enforces here.
- **Reference only commands that exist.** Guidance naming an unbuilt command teaches agents to run something that errors. Describe the artifact (`.brain/evals/<suite>/cases.jsonl`) and an existing verb until the command actually ships — then update the playbooks in the same change that ships it.
- **Adapters stay pure JSON normalizers.** No vendor SDK, no network. A schema drift produces a NAMED error (which adapter, which file, which field) plus the `--adapter envelope` escape hatch — never a run of silently-zero scores.
- **Nothing gets recorded from a failed run.** Runner non-zero, timeout, or unparseable output = `opError`, no `runs.jsonl` line. A half-run that looks like evidence is worse than no run.
- **Numbers reaching a checkpoint come from a run record.** `progress add --eval` reads the suite's own last run; never accept a score as a caller-supplied string.

## Don't

- Don't duplicate the whole AI standard into another playbook — the branches point at `brain playbook ai` and state only what changes for their step.
- Don't add an AI branch that fires on non-AI work. Every branch opens with an explicit skip condition; nagging on a CSS fix is how agents learn to skim playbooks.
- Don't soften the two absolutes: **a failing frozen regression case blocks the change**, and **a model/settings change is a prompt change**. These are the two clauses that make the rest enforceable.

## Update triggers

- New eval command lands → update `playbook ai` §5 + `execute` 3b + `done` §2b to name it, then `skill --write`
- New adapter → `EVAL_ADAPTERS` + `adaptRunOutput` + the skill's runner/adapter contract paragraph + a case in `skill-coverage`
- `.brain/evals/` shape changes → `validateSuiteShape`/`loadCases` + `playbook ai` §3 + `initEvalsIndexMd` + this doc
- Agent topology state lands (`.brain/agents/`) → `playbook ai` §7 + `plan` §13 + new `brain check` rows
- Any new AI branch in a playbook → add a row to the surface table above

## Provenance

Plan `ai-work-harness` (2026-07-28, reviewed 2 rounds). Decisions locked there and binding on this surface: prompts live in the app repo with the brain holding a pointer; evals run through a project-declared shell runner; the `evals` verify stage is opt-in, never in the default `verify` stage; frozen cases hard-fail while aggregates get a tolerance band; run records carry `trace_url` and token/cost usage; agent roles are descriptive but carry an optional `impl` pointer to something runnable.
