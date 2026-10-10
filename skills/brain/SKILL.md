---
name: brain
description: "Use in any repo with a .brain/ directory — orient on project state (features, latest checkpoint, what's next), look up rules/recipes/docs, and route to the right brain-* phase skill. Also when asked what's in progress, what to do next, or to set up a brain (npx -y brain-axi init)."
---

# brain — router for the .brain harness

`brain` queries and updates the repo's `.brain/` (features, checkpoints, rules, run notes, plans, verifications). Every command prints TOON (toonformat.dev) on stdout; stderr is diagnostics only. Exit 0 = success (a no-op too), 1 = operation failed, 2 = usage error. Every result ends with a `help:` list naming the next command — follow it. Errors print `error:` plus a corrected `help:`. Run from anywhere inside the repo; without `brain` on PATH use `npx -y brain-axi <command>`. Every command supports `--help`.

## No `.brain/` yet?

`npx -y brain-axi init` creates `.brain/brain.db` (SQLite, gitignored; needs Node >= 24) and seeds the first checkpoint with the real branch. It refuses an existing brain, and a markdown-era `.brain/` (LEGACY_BRAIN: pin `npx -y brain-axi@0.2.0` there).

## Orient (start of session)

- `npx -y brain-axi` — dashboard: feature counts, in-progress feature, last checkpoint, next step, open review sessions
- `npx -y brain-axi progress list` — recent checkpoints (branch, next, linked run)
- `npx -y brain-axi features list` — feature list with status; `features view <slug>` for tasks, verdict and doc

Then use the phase skill for what you are about to do (below).

## Phase skills — use the one whose trigger fits

| skill | use when |
|---|---|
| `brain-start` | before editing code on any non-trivial task: read state, frame scope, baseline (`brain verify --stage baseline`), claim the feature |
| `brain-grill` | before a plan that carries a decision: check the brain for settled answers, interview the human |
| `brain-plan` | any plan/proposal/design: one HTML artifact, 17-section structure, reviewed in `brain review` |
| `brain-product` | planning user-facing work: the product brief (problem, user, metric, non-goals, scope tiers) |
| `brain-ux` | planning a screen change: UI mockups + UX flows, screen-state matrix |
| `brain-ai` | prompts/models/agents/evals: golden set, a frozen regression case per fixed bug, `brain playbook ai` standard |
| `brain-execute` | implementing an approved plan: in-progress, `watch`, verbatim `runs append`, contract first |
| `brain-verify` | independent skeptical check of a user-visible feature, verdict doc |
| `brain-done` | before declaring complete / opening a PR: verify, check, coherence, ship |
| `brain-write` | writing anything into the brain: checkpoints, run notes, docs, commit bodies |

## Plans: review by default

A request for a plan, proposal, design, or approach review is never answered in chat. Use `brain-plan`: write ONE HTML artifact, `npx -y brain-axi review <plan.html>`, then `npx -y brain-axi review poll <plan.html>` in the foreground until the human approves (`review end` after). `plans view <slug>` prints each round's `snapshot:` — verify shipped UI against the approved one, the FROZEN copy the human approved, never the live file.

## Command map (every command; `npx -y brain-axi <cmd>`)

- `init` — create brain.db. `context` — the SessionStart hook's compact block; silent outside a brain. `export [--out f]` / `import <file>` — TOON backup ↔ an empty brain.
- `features list|view|add|set|ship` — tracker; one in-progress at a time; `set --pr <url>` records the PR; `ship <slug> --evidence "..."` needs a PASS verification.
- `tasks list|view|add|claim|set <slug> ...` — task slices; a worker starts with `tasks view <slug> <task>` (the brief).
- `progress list|add --summary "..." --next "..." [--run <name>]` — checkpoints (summary ≤ 200 chars). `runs view|append <slug> --step "..." --observed "..."` — verbatim run steps.
- `docs list|view|set|rm`, `search "<q>" [--kind doc]` — rules, recipes, codebase docs; full-text search over everything.
- `check` — integrity + cross-entity rules (exit 1 on fail). `verify list|add|run [--stage bootstrap|baseline|verify] [--only <name>]` — declared project checks.
- `review open|poll|end <plan.html>` (`end --approved-by <who>` headless), `plans list|view` — human plan review and history.
- `verifications list|view|add <slug> --verdict PASS|FAIL|BLOCKED --body-from <f> [--shot <img>]` — verdicts stamped with the commit. `watch <slug>` — live dashboard.

Record state with `brain-write`; never paste verbatim output into a checkpoint (it goes to `runs append --observed`).
