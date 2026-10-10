# Feature: axi-core — skills over a thin AXI over a SQLite library

_Last updated: 2026-10-10 (e2e audit)_

## Purpose
Three layers only: skills (method, sequential handoffs) → AXI CLI (thin, TOON) → lib/brain (SQLite, per-domain functions, migrations). Plan: `plans/2026-10-10-axi-architecture.html` (reviewed round 1). Supersedes sqlite-engine (feat-012, cut).

## Phases
1. Library + tests. 2. AXI on the library (15 commands). 3. Review + watch UIs on the library. 4. Skills on the new surface; evals repo-dev; HARNESS.md folded into skills. 5. Rebuild this repo brain from live parts. 6. (e2e audit) Prove the old brain is gone, then ship (release, Greptile 5/5, PR).

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

## E2E audit (2026-10-10) — nothing left over
Every tracked path (`git ls-files` + `ls -R .brain`, 54 items) was checked against the phases: 19 OWNED, 7 KEEP, 28 MISSING. Each MISSING item now has an owner, written into `plans/2026-10-10-axi-architecture.html` (marked *e2e audit*), with new sections `#deletion-manifest` and `#acceptance-old-brain-gone` and a new phase 6.

### Owners added
| Missing item | Phase |
|---|---|
| Top-level `ship` (in neither the cut nor the fold list) → `features ship`; COMMANDS counts 16 keys if export/import are separate | 2 |
| `lib/state.js` deletion moves from phase 2 to phase 3 (`brain-data.js` imports it) | 3 |
| Node gate before a dynamic `import()` of lib/brain; `context` silent on Node <24 and on a legacy brain | 2 |
| Legacy file brain (no brain.db) → BrainError LEGACY_BRAIN; `init` refuses to write over one | 2 |
| `.github/workflows/ci.yml`: Node 24; no DB in CI, so tests + check-skills + init smoke | 2 |
| Bridge: `scripts/import-legacy-brain.mjs` runs at the end of phase 2; old files frozen; dogfood on brain.db | 2 (deleted in 6) |
| `features.grandfathered` (replaces `policy.strict_grandfathered`); `docs.section` CHECK values | 1 |
| `docs/REVIEW-ARCHITECTURE.md` rewritten; UI payload fields kept in the same shape | 3 |
| Skill refs to `brain evals`, `timeline`, `metrics`, `brief`, `receipt`, `shots`, `pr`, `ship`, `setup` and markdown paths (`playbook` alone is in 30 skill files) | 4 |
| brain-ai/start/done/execute evals steps (the command is cut) → a verify-check suite (open) | 4 |
| `scripts/eval-skill-*.mjs` repointed to `evals/` and made standalone | 4 |
| `evals-plugin/fixtures/brain/` (markdown fixture) deleted; `scaffold-brain.sh` uses `brain init` | 4 |
| `plugin.json` `experimental.evals` path | 4 |
| `docs/HARNESS-INTEROP.md` deleted | 4 |
| `.brain/high-level-architecture/` rewritten and imported | 5 |
| Feature docs `features/*/<slug>.md` → `features` doc rows | 5 |
| `pr.json` → `pr_url`; tracker evidence | 5 |
| Newest checkpoint + a "brain rebuilt" checkpoint | 5 |
| axi-core plan registered (path + sha256, approved) | 5 |
| Rules/recipes/codebase rewritten before import (`state.md` dropped) | 5 |
| `verify.json` contents rewritten (all 4 checks call deleted code) | 5 |
| Drop list: `.brain/CHANGELOG.md`, emails/transcripts stubs, `_TEMPLATE`/`index.md`, run notes, verifications, screenshots, `tasks.json`, review sessions | 5 |
| `.gitignore` (brain.db*, export.toon; drop gates.jsonl, tasks.json.lock) | 5 |
| Stray root `2026-08-06-task-coordination.html` → `plans/` | 5 |
| CLAUDE.md, README and CHANGELOG pinned to phase 5 (they had no phase); the `docs/assets` CLI captures re-shot, `shots-notes.png` deleted | 5 |
| Version 0.3.0 in package.json and plugin.json; npm publish at merge (skills call `npx -y brain-axi`) | 6 |
| `package.json` `files` allowlist (npm ships scripts/, evals-plugin/, plans/, docs/ today) | 6 |
| Fresh-repo end-to-end skill chain on brain.db + headless `claude -p` hook check; Greptile 5/5 → PR | 6 |

KEEP: `plans/*.html` (approved artifacts, path + hash), `lib/review` static assets + `sdk.js` + `vendor/`, `evals-plugin/results/**` (run records), `hooks/hooks.json` (`context` survives), `marketplace.json`, `.gitattributes`, the `docs/assets` UI screenshots.

### Deletion manifest (path → fate → phase)
- `.brain/HARNESS.md` → method into skills, rest dropped → 4
- `.brain/evals/**` (33 run records + jsonl) → `git mv` to `evals/`, byte-identical, never deleted → 4
- `.brain/rules|recipes|codebase|high-level-architecture/*.md` → rewritten into docs rows; `state.md` and `index.md` dropped → 5
- `feature_list.json` + `pr.json` + `features/*/<slug>.md` → `features` rows + feature docs → 5
- `runs/progress.md` → newest checkpoint only → 5; `verify.json` → rewritten `verify_checks` → 5
- run notes, verifications, screenshots, `tasks.json`, `.brain/plans/**`, `features/*/plans/**`, `.brain/CHANGELOG.md`, emails/transcripts stubs, `_TEMPLATE.md`, `index.md` → dropped (git history) → 5
- `bin/brain.js` cut/folded commands + init's md templates; `lib/review/playbooks.js`; `scripts/check-{state-invariants,playbook-refs}.mjs` → 2
- `lib/state.js`, `lib/review/{brain-data,store,evals}.js` → 3
- `evals-plugin/fixtures/brain/**`, `docs/HARNESS-INTEROP.md` → 4; `docs/assets/shots-notes.png` → 5; `scripts/import-legacy-brain.mjs` → 6

### Acceptance: old brain gone (phase 6, final HEAD)
- [ ] `git ls-files .brain` prints nothing (or only shots, if they stay tracked)
- [ ] On disk, `.brain/` holds only brain.db*, export.toon and shot images: zero `.md`/`.json`/`.jsonl`
- [ ] `git grep -nE "(brain|brain-axi) (playbook|skill|setup|timeline|metrics|shots|receipt|brief|pr|ship|evals)\b"` over skills, bin, lib, hooks, .claude-plugin, README, CLAUDE.md, docs, .github, scripts, evals-plugin is empty
- [ ] No markdown-era paths (`feature_list.json`, `progress.md`, `verify.json`, `HARNESS.md`, `.brain/<section>/`) in the shipped surface (CHANGELOG history excepted)
- [ ] The deleted modules, scripts, docs and fixture do not exist
- [ ] `COMMANDS` keys = documented surface = `brain --help`
- [ ] `node --test test/brain`, `check-skills.mjs`, `brain check` and `brain verify run --stage baseline` all exit 0
- [ ] Eval run records intact (100% renames, count unchanged)
- [ ] Fresh temp repo: `brain init` → full skill chain → `features ship`; no `.md` under `.brain/`
- [ ] Headless `claude -p` hook prints context; it is silent on Node 22, outside a brain, and on a legacy brain
- [ ] `npm pack --dry-run` lists only the allowlist; versions 0.3.0 match; engines `node >=24`
- [ ] `.gitignore` covers brain.db*, export.toon; tree clean after a session
- [ ] CI green; Greptile 5/5 on the final HEAD; PR open

### Open (needs Sean)
1. brain-ai without `evals`: recommended, a suite = a declared verify check, with no eval tables.
2. Shots under `.brain/`: recommended, gitignore them too, so `git ls-files .brain` is empty.
3. Phase 5 drop list (run notes, old checkpoints, verification docs, screenshots, review sessions): recommended, drop them. Eval run records are moved, never dropped.
4. Bridge for phases 2–4: recommended, import at the end of phase 2 (or pin `brain-axi@0.2.0` until phase 5).
