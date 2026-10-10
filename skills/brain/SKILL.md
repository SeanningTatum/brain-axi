---
name: brain
description: "Use in any repo with a .brain/ directory — orient on project state (features, latest checkpoint, what's next), look up rules/recipes/docs, and route to the right brain-* phase skill. Also when asked what's in progress, what to do next, or to set up a brain (npx -y brain-axi init)."
---

# brain — router for the .brain harness

`brain` queries and updates the repo's `.brain/` (features, checkpoints, rules, run notes, plans, verifications). Every command prints TOON (toonformat.dev) on stdout; stderr is diagnostics only. Exit 0 = success (a no-op too), 1 = operation failed, 2 = usage error. Every result ends with a `help:` list naming the next command — follow it. Errors print `error:` plus a corrected `help:`. Run from anywhere inside the repo; without `brain` on PATH use `npx -y brain-axi <command>`. Every command supports `--help`.

## No `.brain/` yet?

`npx -y brain-axi init` scaffolds a minimal `.brain/` (HARNESS.md, feature_list.json, progress.md, verify.json, doc stubs); `--agents-md` also writes an AGENTS.md pointer + CLAUDE.md symlink; `--state-only --dir <repo> --yes` wipes cloned state but keeps the docs. It never clobbers an existing `.brain/` (exit 1).

## Orient (start of session)

- `npx -y brain-axi` — dashboard: feature counts, in-progress feature, last checkpoint, open review sessions
- `npx -y brain-axi progress` — latest checkpoint in full (branch, next step)
- `npx -y brain-axi features` — feature list with status; `features view <slug>` for the doc

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

If skills are unavailable, `brain playbook <id>` prints the same text (`brain playbook` lists them; `--ref <topic>` prints a reference).

## Plans: review by default

A request for a plan, proposal, design, or approach review is never answered in chat. Use `brain-plan`: write ONE HTML artifact, `npx -y brain-axi review <plan.html>`, then `npx -y brain-axi review poll <plan.html>` in the foreground until the human approves (`review end` after). `plans view <slug>` prints each round's `snapshot:` — verify shipped UI against the approved one, the FROZEN copy the human approved, never the live file.

## Command map (every command; `npx -y brain-axi <cmd>`)

- `npx -y brain-axi init` — scaffold `.brain/`. `npx -y brain-axi setup --app claude|codex|opencode` — SessionStart hook (idempotent). `npx -y brain-axi context` — that hook's compact block; silent outside a brain. `npx -y brain-axi skill [--write|--check]` — print/regenerate/validate this skill tree.
- `features [view <slug>]`, `features set-status <slug> --status planned|in-progress|shipped|blocked|cut`, `features index [--write]` — tracker; one-in-progress policy; `shipped` needs `--evidence`.
- `tasks <slug>`, `tasks add|claim|done|view <slug> ...`, `brief <slug> <task-id>` — task slices; a worker starts with `brief`.
- `progress [add --summary "..." --next "..."]` — checkpoints (summary capped at 200 chars). `runs [view <name>|append <slug> --step "..." --observed "..."]` — deep run notes, verbatim.
- `docs [<section>|view <section/doc>]`, `search "<q>" [--section rules]` — rules, recipes, codebase docs.
- `evals [run <suite>|golden ...]` — AI eval suites; `verify --stage evals` is the AI gate.
- `check [--strict]` — harness invariants (exit 1 on fail). `verify [--stage bootstrap|baseline|verify] [--only <name>] [--feature <slug>]` — run `.brain/verify.json` checks. `metrics` — gate effectiveness.
- `review <plan.html> [--feature <slug>]`, `review poll|end`, `plans [view <slug>]`, `timeline` — human plan review and history.
- `shots add <img> --feature <slug> --step NN-name`, `shots [<feature>]`, `shots notes <feature>` — screenshot evidence.
- `verifications [<slug>|view <slug> <date>]`, `receipt <slug> --verified-by <v> --implemented-by <i>` — verdict docs and commit-bound receipts.
- `ship <slug> --evidence "..."`, `pr <slug> --url <url>`, `watch <slug>` — close a feature, record the PR, live dashboard.
- `playbook [<id> [--ref <topic>]]` — the phase-skill texts as a CLI fallback.

Record state with `brain-write`; never paste verbatim output into `progress.md` (it goes to `runs append --observed`).
