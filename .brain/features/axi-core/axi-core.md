# Feature: axi-core — skills over a thin AXI over a SQLite library

_Last updated: 2026-10-10_

## Purpose
Three layers only: skills (method, sequential handoffs) → AXI CLI (thin, TOON) → lib/brain (SQLite, per-domain functions, migrations). Plan: `plans/2026-10-10-axi-architecture.html` (reviewed round 1). Supersedes sqlite-engine (feat-012, cut).

## Phases
1. Library + tests. 2. AXI on the library (15 commands). 3. Review + watch UIs on the library. 4. Skills on the new surface; evals repo-dev; HARNESS.md folded into skills. 5. Rebuild this repo brain from live parts.

## Test-run findings (2026-10-10) — mapped
Source: an end-to-end test (an Opus agent built a kanban app in `~/Desktop/personal-projects/brain-todo-test`, log in its `SESSION_LOG.md`) routed all 10 skills correctly and shipped, but hit 13 findings. They are mapped below and written into `plans/2026-10-10-axi-architecture.html` (AXI table, schema, phases, error paths, testing plan; each marked `#N`).

| # | finding | verdict | phase |
|---|---------|---------|-------|
| 1 | `init` features/index.md lacks `<!-- brain:features-table -->` markers → `check` fails, `features index --write` exits 1 | obsolete on SQLite (no generated md index) | — |
| 2 | `init` rules/index.md lacks the Touches column `brief` parses | obsolete on SQLite | — |
| 3 | `init` checkpoint has `branch: unknown`, no `- next:` line | add: `init` seeds first checkpoint with real git branch (`none` without git) + a `next` line; port `resolveBranch`/`initProgressMd` from stash | 2 |
| 4 | `tasks done` on last task prints `ship: refused` but exits 0; receipt hint hardcodes `bun run test`/`typecheck` | add: closing last task via `tasks.set` still auto-ships (keep autoship); `features.ship` returns a structured outcome; refusal is a BrainError → exit 1; hint built from `verify_checks`, never a hardcoded runner. Port exit-1-on-refused + receipt hint from stash | 1 (domain), 2 (CLI) |
| 5 | `ship` truncates checkpoint evidence at 200 chars, no ellipsis | add: `features.ship`/`progress.add` clip with trailing `…` or throw SUMMARY_TOO_LONG, never silent; port `clipChars` from stash | 1 |
| 6a | dashboard `features: "0 total ()"` | obsolete on SQLite (home rebuilt on `features.stats`) | — |
| 6b | no-brain error doesn't suggest init | covered (BrainError NO_DB, `help:` `brain init`/`brain import`) | 2 |
| 6c | `brain --help` doesn't list commands | add: test that `brain --help` lists every command | 2 |
| 7 | no `brain features add` | covered (`features add` in the 15-command surface) | 2 |
| 8 | no unattended plan approval (plan stays draft, rounds 0) | add: `review end --approved-by <who>` for headless/CI, sets approved + increments round | 3 |
| 9 | `progress add` can't link a run note | add: `checkpoints.run` nullable column; `progress add --run <name>`; `progress list` shows it | 1 (schema), 2 (CLI) |
| 10 | brain-start baselines verify.json's placeholder `echo` | skill text fixed in PR #21; add: `init` seeds no placeholder check; `verify run` with zero checks → BrainError NO_CHECKS, help "declare real checks with `brain verify add`" | #21 + 2 |
| 11 | `brain receipt` needs a clean tree; verify skill never says so | skill text fixed in PR #21; add: `verifications add` records commit, on dirty tree records `dirty:true` (or fails with a help line), documented in brain-verify | #21 + 2 |
| 12 | `brain playbook verify` ~29.8KB — not reproduced | obsolete (`playbook` is cut) | — |
| 13 | plan tier guidance contradicts itself → oversized plans | skill text fixed in PR #21; carry the tier text into brain-plan | #21 + 4 |

Stash `stash@{0}` ("paused: fresh-brain bug fixes from test run") is an idea source only: `clipChars` → phase 1; exit-1-on-refused + receipt hint, `resolveBranch`/`initProgressMd` → phase 2. Drop it once axi-core lands.
Not covered by the test: SessionStart hook firing (sub-agents don't fire it) — test with headless `claude -p` in a fresh repo.
