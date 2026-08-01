# Features — Index

Per-feature memory. **One MD per shipped or in-progress feature** — captures purpose, runtime flow, key files, dependencies, errors, changelog. Loaded by agents *before* touching a feature so they understand intent and existing surface.

## When to read

- About to modify a feature → read its file first
- Deciding scope of a new feature → check for adjacent features that overlap
- Investigating a bug → confirm expected behavior matches what's documented

## When to write

- New feature ships → create the file in the same PR
- Bugfix that changes runtime behavior → append to feature's changelog table
- Feature ripped out → **delete the file** (never leave stale memory)

## Conventions

- Layout: `features/<kebab-slug>/<kebab-slug>.md` (e.g. `features/file-upload/file-upload.md`) — one folder per feature, holding the doc plus `screenshots/`, `verifications/`, `runs/`, and `plans/` for that feature (see `brain-review` docs for the full per-feature tree)
- Use [`_TEMPLATE.md`](_TEMPLATE.md) as starting point
- `_Last updated: YYYY-MM-DD_` at top — refresh on every edit
- `Key Files` table = source of truth for what code belongs to feature
- `Changelog` table appends newest entry on top
- Register file in the index table below and in [`feature_list.json`](feature_list.json) (`doc` points at `features/<slug>/<slug>.md`)

## Files

> **Generated — do not hand-edit between the markers.** Run
> `brain features index --write`. `feature_list.json` is the source of truth, and
> `brain check` fails on any disagreement ("features/index.md agrees with the
> tracker"). This table previously sat two features behind and claimed
> `brain review` was in-progress for two weeks, because nothing compared them.

<!-- brain:features-table -->
| Feature | Memo | Status | Latest verification |
|---------|------|--------|---------------------|
| Core AXI CLI | [`core-cli/core-cli.md`](core-cli/core-cli.md) | shipped | — |
| brain review — interactive plan review surface | [`brain-review/brain-review.md`](brain-review/brain-review.md) | shipped | [2026-07-16 PASS](brain-review/verifications/2026-07-16.md) |
| shot-review — screenshot carousel + annotation | [`shot-review/shot-review.md`](shot-review/shot-review.md) | shipped | [2026-07-17 PASS](shot-review/verifications/2026-07-17.md) |
| annotation-watch — post-ship feedback runner | [`annotation-watch/annotation-watch.md`](annotation-watch/annotation-watch.md) | planned | — |
| harness-mode — AGENTS.md parity (verify runner + bookend playbooks + init) | [`harness-mode/harness-mode.md`](harness-mode/harness-mode.md) | shipped | — |
| ai-work — AI-aware harness (evals, golden sets, prompt review) | [`ai-work/ai-work.md`](ai-work/ai-work.md) | blocked | — |
| planning-ux — product-grade planning (mockups, UX flows, product playbook) | [`planning-ux/planning-ux.md`](planning-ux/planning-ux.md) | shipped | [2026-07-30 PASS](planning-ux/verifications/2026-07-30.md) |
| state-integrity — enforceable state, commit-bound evidence, gate telemetry | [`state-integrity/state-integrity.md`](state-integrity/state-integrity.md) | in-progress | — |
<!-- /brain:features-table -->

## Important things to look at

- [`_TEMPLATE.md`](_TEMPLATE.md) — copy this for every new feature
- An existing feature's `Key Files` table mirrors the import surface — if you find a file not listed there, the doc is stale or the file is orphaned

## Update trigger

Add a row to the table above whenever a feature MD is created, and remove the row when the feature is deleted. Keep [`feature_list.json`](feature_list.json) in sync.
