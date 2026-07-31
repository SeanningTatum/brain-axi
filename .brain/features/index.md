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

> Statuses mirror `feature_list.json`, which is the source of truth. `brain check`
> now FAILS on any disagreement (the "features/index.md agrees with the tracker"
> row) — this table sat two features behind and claimed `brain review` was still
> in-progress for two weeks. Until it is generated, update both together.

| Feature | File | Status | Last updated |
|---------|------|--------|--------------|
| Core AXI CLI | [`core-cli/core-cli.md`](core-cli/core-cli.md) | shipped | 2026-07-14 |
| brain review | [`brain-review/brain-review.md`](brain-review/brain-review.md) | shipped | 2026-07-16 |
| shot review | [`shot-review/shot-review.md`](shot-review/shot-review.md) | shipped | 2026-07-17 |
| annotation watch | [`annotation-watch/annotation-watch.md`](annotation-watch/annotation-watch.md) | planned | 2026-07-17 |
| harness mode | [`harness-mode/harness-mode.md`](harness-mode/harness-mode.md) | shipped | 2026-07-23 |
| AI work | [`ai-work/ai-work.md`](ai-work/ai-work.md) | blocked | 2026-07-31 |
| planning UX | [`planning-ux/planning-ux.md`](planning-ux/planning-ux.md) | shipped | 2026-07-30 |
| state integrity | [`state-integrity/state-integrity.md`](state-integrity/state-integrity.md) | in-progress | 2026-07-31 |

## Important things to look at

- [`_TEMPLATE.md`](_TEMPLATE.md) — copy this for every new feature
- An existing feature's `Key Files` table mirrors the import surface — if you find a file not listed there, the doc is stale or the file is orphaned

## Update trigger

Add a row to the table above whenever a feature MD is created, and remove the row when the feature is deleted. Keep [`feature_list.json`](feature_list.json) in sync.
