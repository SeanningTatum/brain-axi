# Feature: axi-core — skills over a thin AXI over a SQLite library

_Last updated: 2026-10-10_

## Purpose
Three layers only: skills (method, sequential handoffs) → AXI CLI (thin, TOON) → lib/brain (SQLite, per-domain functions, migrations). Plan: `plans/2026-10-10-axi-architecture.html` (reviewed round 1). Supersedes sqlite-engine (feat-012, cut).

## Phases
1. Library + tests. 2. AXI on the library (15 commands). 3. Review + watch UIs on the library. 4. Skills on the new surface; evals repo-dev; HARNESS.md folded into skills. 5. Rebuild this repo brain from live parts.

## Pending: map test-run findings onto this plan (2026-10-10)
An end-to-end test (Opus agent built a kanban app in `~/Desktop/personal-projects/brain-todo-test`,
log in its `SESSION_LOG.md`) routed all 10 skills correctly and shipped, but hit these. Next step:
a sub-agent maps each to {covered by an axi-core phase | add to a phase | fix now in PR #21 | obsolete on SQLite}.
Partial, uncommitted fixes for 1-7/10/11/13 are parked in `git stash` "paused: fresh-brain bug fixes from test run".

1. `init` scaffolds features/index.md without `<!-- brain:features-table -->` markers → `check` fails after first feature; `features index --write` exits 1.
2. `init` rules/index.md lacks the Touches column `brief` parses → warning on every fresh brain.
3. `init` checkpoint has `branch: unknown`, no `- next:` line.
4. `tasks done` on last task prints `ship: refused` but exits 0; receipt hint hardcodes `bun run test`/`typecheck` (lib/state.js ~535).
5. `ship` truncates checkpoint evidence at 200 chars with no ellipsis.
6. Output: dashboard `features: "0 total ()"`; no-brain error doesn't suggest init; `brain --help` doesn't list commands.
7. No `brain features add` (agents hand-edit feature_list.json).
8. No unattended plan approval (`--approved-by` for CI/headless) — plan stays draft, rounds 0. (deferred: axi-core `review`)
9. `progress add` can't link a run note. (deferred: axi-core)
10. brain-start baselines verify.json's placeholder `echo` — must say fill real checks first.
11. `brain receipt` needs a clean tree; verify skill never says so; non-strict check misses it.
12. `brain playbook verify` ~29.8KB reported — NOT reproduced (10KB on this branch). (deferred)
13. Plan tier guidance contradicts itself ("write small" vs "user-facing = full") → oversized plans.
Not covered by the test: SessionStart hook firing (sub-agents don't fire it) — test with headless `claude -p` in a fresh repo.
