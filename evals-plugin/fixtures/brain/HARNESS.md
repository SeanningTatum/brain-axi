# HARNESS.md — the harness, explained

> One-stop explainer for what holds this project together for AI agents. Read this once when joining the repo; update it when the harness itself changes (not when individual features change — that's .brain/features/).

This repo runs a 5-subsystem harness:

1. **Instructions** — what to read before working. <name your instruction docs here — CLAUDE.md/AGENTS.md, .brain/rules/, .brain/codebase/, .brain/high-level-architecture/>
2. **State** — what's done, in progress, where things were left off. `features/feature_list.json` (status/dependencies/evidence) + `runs/progress.md` (rolling session cursor) + `runs/<date>-<slug>.md` (deep per-task state).
3. **Verification** — how to prove a change is correct. `.brain/verify.json` registers your project's real checks (typecheck/test/build/lint); `brain verify` runs them. <replace the placeholder check with your real commands>
4. **Scope** — what counts as "this task" (and what doesn't). `policy.one_in_progress_at_a_time` in `feature_list.json` enforces one feature in flight at a time. <add project-specific scope rules here>
5. **Lifecycle** — bootstrap, session handoff, clean restart. <describe how a fresh agent should pick this up — usually: run `brain` (or `npx -y brain-axi`), read `runs/progress.md`, check `brain features`>

Operate this harness with the `brain` CLI (`npx -y brain-axi <command>` if it isn't installed on PATH): `brain features`, `brain progress`, `brain docs`, `brain search`, `brain check`, `brain verify`. Run `brain` with no arguments for the live dashboard.

## Fill these in

- [ ] Name the real doc locations for the Instructions layer above.
- [ ] Replace the placeholder check in `.brain/verify.json` with your real typecheck/test/build/lint commands.
- [ ] Add your first feature to `features/feature_list.json` (or via `brain features` once one exists).
- [ ] Fill in `rules/`, `recipes/`, `codebase/`, `high-level-architecture/` as real docs accumulate — the `index.md` stubs are placeholders.
- [ ] Describe any project-specific scope/lifecycle rules above.
