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
| 2026-07-31 | decision | **`brain ship` is now preflight-then-commit.** It previously wrote `feature_list.json` and appended the progress checkpoint, THEN ran `brainCheck`, then exited 1 with the flip already on disk — specified behavior (`docs/REVIEW-ARCHITECTURE.md`), reasoned as reporting the failure honestly. Reversed: reporting a failure honestly does not stop later reads from seeing a feature marked `shipped` on a brain that never passed its checks. `brainCheck` gained `opts.list` so a projection is validated before any write; on failure nothing is written and the previous status stands. See `.brain/features/state-integrity/state-integrity.md`. |
| 2026-07-31 | feature | **state-integrity (feat-008), phase 1.** New `lib/state.js` — the first non-`review/` module in `lib/` and the shared owner of the feature-list schema, the single verdict parser, and `writeFileAtomic`. `brain check`'s first row became real structural validation (`{}`, `[]`, `"hello"`, `42`, duplicate ids/slugs, unknown status, shipped-without-evidence were all previously accepted as "feature_list.json parses"). ONE `parseVerdict` replaces two that disagreed — the old one decided purely by emoji substring, so `**Verdict**: PASS` read as `unknown` on every display surface while `brainCheck`'s presence-only regex passed it. New checks: readable verdict, verification image links resolve. `brainCheck` now honors `policy.one_in_progress_at_a_time` instead of hardcoding it (it disagreed with `features set-status`). New rule 7 `rules/state.md`. |
| 2026-07-31 | chore | **First CI, and the repo's first automated tests.** `scripts/check-state-invariants.mjs` — 78 assertions over synthetic brains in a temp dir, every case a shape that used to pass silently — registered in `.brain/verify.json` and run by a new `.github/workflows/ci.yml` (`brain verify --stage baseline`, Node pinned, zero-dep invariant asserted). `skill --check` was called "intended for CI" in four places with nothing running it. No test framework added: plain node scripts + the check registry, per `codebase/programming-model.md`. `bootstrap` stage now has declared checks (it was a silent 0-match no-op). |
| 2026-07-30 | brain | Vendored the AXI standard from [kunchenguid/axi](https://github.com/kunchenguid/axi) (MIT, © 2026 Kun Chen) into the repo as the installable `brain-axi` skill (`.claude/skills/brain-axi/SKILL.md`); attribution in `THIRD-PARTY-NOTICES.md`. `HARNESS.md`, `rules/toon-axi.md`, and `CLAUDE.md` previously pointed at a global-only `axi` skill that no cloner had; all three now resolve in-repo. Not covered by `brain skill --check` — it is upstream's doc, not a mirror of our CLI surface, so re-sync manually against upstream. |
| 2026-07-23 | feature | harness-mode: brain-axi becomes a full 5-subsystem harness — `brain verify` (declared check registry `.brain/verify.json`, stages bootstrap/baseline/verify), `start`/`done` bookend playbooks, `brain init` scaffolder. Replaces bespoke init.sh/verify scripts in target repos; `setup --commands` generation deferred (plan harness-parity D0). See `.brain/features/harness-mode/harness-mode.md`. |
| 2026-07-14 | brain | Turned `.brain` onto brain-axi itself — replaced base-template placeholders with real harness (HARNESS, codebase/programming-model, 4 layer rules, architecture, feat-001 core-cli, feat-002 brain-review). See `.brain/HARNESS.md`. |
| 2026-07-13 | feature | First iteration committed (c1b0880). |
