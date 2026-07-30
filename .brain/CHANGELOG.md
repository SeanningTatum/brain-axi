# Brain Changelog

High-level project + brain changes. **Not a code changelog** (see `git log` for that). This tracks:

- Architectural shifts (e.g. "migrated to X")
- New features shipped (with link to `features/<slug>.md`)
- Brain restructures (folder splits, doc rewrites)
- Decisions reversed
- External constraint changes (legal, vendor, deadline) sourced from `transcripts/` or `emails/`

## Conventions

- Newest entry on top
- Date format: `YYYY-MM-DD`
- One entry per change. Use the type tags: `feature` `bugfix` `refactor` `decision` `brain` `chore`
- Link out: `See .brain/features/<slug>.md`, `See .brain/transcripts/<file>.md`, `See PR #<n>`

## Entries

| Date | Type | Description |
|------|------|-------------|
| 2026-07-30 | brain | Vendored the AXI standard from [kunchenguid/axi](https://github.com/kunchenguid/axi) (MIT, © 2026 Kun Chen) into the repo as the installable `brain-axi` skill (`.claude/skills/brain-axi/SKILL.md`); attribution in `THIRD-PARTY-NOTICES.md`. `HARNESS.md`, `rules/toon-axi.md`, and `CLAUDE.md` previously pointed at a global-only `axi` skill that no cloner had; all three now resolve in-repo. Not covered by `brain skill --check` — it is upstream's doc, not a mirror of our CLI surface, so re-sync manually against upstream. |
| 2026-07-23 | feature | harness-mode: brain-axi becomes a full 5-subsystem harness — `brain verify` (declared check registry `.brain/verify.json`, stages bootstrap/baseline/verify), `start`/`done` bookend playbooks, `brain init` scaffolder. Replaces bespoke init.sh/verify scripts in target repos; `setup --commands` generation deferred (plan harness-parity D0). See `.brain/features/harness-mode/harness-mode.md`. |
| 2026-07-14 | brain | Turned `.brain` onto brain-axi itself — replaced base-template placeholders with real harness (HARNESS, codebase/programming-model, 4 layer rules, architecture, feat-001 core-cli, feat-002 brain-review). See `.brain/HARNESS.md`. |
| 2026-07-13 | feature | First iteration committed (c1b0880). |
