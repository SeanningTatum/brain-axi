# Feature: state-integrity — enforceable state, commit-bound evidence, gate telemetry

_Last updated: 2026-07-31_

## Purpose

Make brain-axi's state layer **enforce** its own invariants instead of documenting them. An audit of
a consuming repo (`cf-saas-starter-react-router`), cross-checked by an independent Codex pass over
this CLI's source, found that `brain check` can report a coherent harness while holding a
contradiction — and that two of the three harness defects named in the literature (*schema
misalignment*, *state degradation*) were live and passing every gate.

The through-line: `brain check` answers "is the harness **intact**?" and is read as "is the harness
**working**?" Those are different questions and only the first was implemented.

## When it's used

Every `brain check`, every `brain ship`, every `brain verify` — i.e. the whole execution loop, in
every repo that installs brain-axi. That reach is why the fixes land here rather than in the
consuming repo.

## The defects it closes

| # | Defect | Evidence at time of writing |
|---|--------|------------------------------|
| 1 | `brainCheck`'s first check asserts only that bytes are valid JSON | `lib/review/brain-data.js:944-955`; `:956` coerces a non-array `features` to `[]`. `status` never validated against `STATUSES`, `id`/`slug` uniqueness never checked, `evidence` never required |
| 2 | `ship` writes state **before** validating and does not roll back | `bin/brain.js:1025` + `:1033` write; `brainCheck` at `:1037`; exit 1 at `:1047`. Specified that way at `docs/REVIEW-ARCHITECTURE.md:534-540` — changed by decision, not as a bugfix |
| 3 | Two verdict readers disagree about the same file | `parseVerdict` (`brain-data.js:577-584`) decides purely by emoji substring, so `**Verdict**: PASS` → `unknown`; `brainCheck:1039-1058` tests only for presence, so the same doc passes |
| 4 | Evidence is unbound to code | Verification docs are date-named mutable markdown. `gitCommit()` exists (`bin/brain.js:1726-1735`) but is used **only** by eval runs |
| 5 | `shipped` requires no proof | `brain check` validates verification docs that exist; never requires one |
| 6 | No adopt/reset path for a cloned template | `brain init` refuses a non-empty `.brain/` (`bin/brain.js:3179-3182`), so a template clone inherits another project's features, cursor, run notes, and screenshots |
| 7 | `brain verify` throws away everything it measures | `runVerifyCheck` (`:729-741`) computes `{status, exit, seconds}` per check; nothing is persisted unless `--feature` is passed, and then only as prose in a markdown fence |
| 8 | The CLI has no automated verification of its own | Zero tests, zero CI — by policy (`.brain/HARNESS.md:58`). `skill --check` is called "intended for CI" in four places; no workflow existed |

Smaller escapes found while mapping: `shots add` silently overwrites an existing step
(`brain-data.js:387-412`); plan `meta.json` stores an absolute machine path in a committed file
(`:182-192`); `resolveBranch` and `gitCommit` shell out to git in different cwds; this repo's own
`verify.json` declares no `bootstrap` check so that stage is a silent no-op; `min_pass_rate` compares
pass rate while `aggregate_tolerance` compares mean score; `EVAL_KINDS` is validated but never
branched on.

## How it works

New `lib/state.js` — the first non-`review/` module in `lib/` — owns what both `bin/` and
`lib/review/` need: the feature-list schema, `validateFeatureListShape`, `parseVerdict`,
`featureListPath`, `readJsonSafe` (today duplicated at `bin/brain.js:3294-3303` and
`brain-data.js:82-89`), `writeFileAtomic`, and `saveFeatureList`.

Validator contract follows the two working precedents in-repo — `validateVerifyShape`
(`bin/brain.js:328-349`) and `validateSuiteShape` (`lib/review/evals.js:68-97`): **return `null` when
valid, else one precise message naming the exact bad field.**

`ship` becomes preflight-then-commit: project the next state in memory, run `brainCheck` against the
projection, and write only on pass. All three writers route through `writeFileAtomic` (temp +
`renameSync`) — `lib/review/server.js:413` already noted that other tools do this and brain-axi did
not.

Per the repo's **read-compat, write-new** rule (`.brain/rules/review-server.md:13`), no format change
is a hard cutover: a verification doc without the new `brain:verification` block reports `legacy`,
not `fail`, and the `shipped ⇒ PASS` invariant ships behind `--strict` for one release before
becoming default.

## Constraints honored

Zero dependencies, no build step, no test framework (`CLAUDE.md:9`, `.brain/rules/cli-commands.md:21`).
stdout stays TOON-only with a mandatory `help[]` block; exit codes stay 0/1/2
(`.brain/rules/toon-axi.md:5-18`). Verification uses the established
`scripts/*.mjs` + `.brain/verify.json` pattern, modeled on `scripts/check-playbook-refs.mjs` and
`scripts/eval-skill-coverage.mjs`.

## Key files

| File | Role |
|------|------|
| `lib/state.js` | **new** — schema, validator, `parseVerdict`, atomic writes, `saveFeatureList` |
| `bin/brain.js` | `cmdShip` reorder, `init --state-only`, `metrics` command, `skillContent()` |
| `lib/review/brain-data.js` | `brainCheck` consumes the validator; `parseVerdict` moves to `lib/state.js`; screenshot-link check |
| `scripts/check-state-invariants.mjs` | **new** — synthetic-brain regression net for the schema + verdict + ship invariants |
| `.brain/verify.json` | registers the new check |
| `docs/REVIEW-ARCHITECTURE.md` | binding contract — `ship` order at `:534-540` + a `lib/state.js` addendum |

## Dependencies

- `core-cli` (feat-001) — command anatomy, output helpers, exit contract
- `brain-review` (feat-002) — `brain-data.js` is its persistence layer
- `ai-work` (feat-006, currently blocked) — the evals subsystem the consuming repo's eval suite uses

## Plan of record

`plans/2026-07-31-harness-hardening.html` — reviewed via `brain review`.

## Changelog

| Date | Type | Description |
|------|------|-------------|
| 2026-07-31 | brain | Feature opened. Audit → plan artifact → review session. `ai-work` flipped to `blocked` to free the one-in-progress slot. |
