# Changelog

All notable changes to `brain-axi` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Harness and brain-state
shifts for this repo's own `.brain/` are logged separately in `.brain/CHANGELOG.md`.

## [Unreleased] — 2026-09-29

**Why:** this release separates the evaluator from the generator, following Anthropic's
[Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps).
Work is now graded by a fresh-context verifier that did not write it. The verifier walks
every acceptance criterion against a contract agreed before any code, scores quality
against hard floors, and re-walks in capped fix rounds.

### Added

- **Playbooks — `verify`**: an independence rule. The verifier is a fresh-context agent
  that did not write the code, declared in the doc header as
  `- **Independence**: independent — <who> | self-verified — <reason>`.
- **Playbooks — `verify`**: an `## Acceptance criteria` table with one row per criterion.
  Rows come from the approved plan of record plus every task's `acceptance` and `verify`.
  A criterion that was never walked blocks a PASS.
- **Playbooks — `verify`**: a three-layer walk: every acceptance criterion, then the
  golden path plus at least one error path, then edge probes.
- **Playbooks — `verify`**: an `## Quality scores` table on a 0–3 scale, rationale first,
  with hard floors: product-depth 2, functionality 2, design 2 (UI only, otherwise N/A),
  code-quality 1. A stub or display-only control is a FAIL.
- **Playbooks — `verify`**: a `- **Round**: N` header line, a skeptical-stance preamble,
  and a §5c CALIBRATION section with good and bad finding examples.
- **Playbooks — `verify`**: `A<N>-<step>` screenshot naming for acceptance-criterion evidence.
- **Playbooks — `verify`**: §6 now stamps the receipt with both
  `--verified-by` and `--implemented-by`.
- **Playbooks — `execute`**: a step 1b CONTRACT. Each task's `--verify` line is agreed
  with the independent verifier before code, then recorded with
  `brain runs append --step "contract agreed"`.
- **Playbooks — `execute`**: a step 4b FIX LOOP. After a FAIL, the next round is either
  refine or pivot, and that choice is recorded before the fix. Each round gets a fresh
  verifier and its own doc: round 1 is `verifications/<YYYY-MM-DD>.md`, round N ≥ 2 is
  `<YYYY-MM-DD>-rN.md`, one Verdict per doc. After 3 rounds the work escalates to the human.
- **Playbooks — `execute`**: a **Verifier (independent)** role in AGENT TOPOLOGY, plus
  rigor scaled by plan tier. **small** gets a contract review and one fresh sub-agent
  verifier. **full** gets an independent verifier and a recommended second adversarial pass.
- **Playbooks — `done`**: §2 now checks three things on the latest verification doc: the
  verifier was independent, every acceptance row is ✅, and no score is under its floor.
  A matching checklist item was added.
- **Playbooks — `plan`**: §10 guidance. Acceptance is a testable behavior, each phase
  carries a `Verify:` clause that becomes the task's `--verify`, and the planner stays at
  product + high-level design (no signatures or line-level edits).
- **CLI — `brain receipt --implemented-by <who>`**: records `implemented_by` in the
  receipt beside `verified_by`. The default is the git author of HEAD.
- **CLI — `brain check --strict`**: a new row, `every shipped feature was verified independently`.
  - `pass` when the identities differ.
  - `warn` when the receipt has `implemented_by` but no `verified_by` (no named verifier).
  - `warn` when `implemented_by` equals `verified_by` (trimmed, case-insensitive). The detail
    says "acknowledged" when the doc declares `- **Independence**: self-verified — <reason>`
    outside fenced or commented blocks.
  - `warn` when the feature's newest verification doc (stem order, so `<date>-rN.md` rounds
    count as newer) is not PASS — an older independent PASS does not hide a newer FAIL. The
    other strict rows still accept any PASS.
  - `skip` when every receipt predates `implemented_by`. The row never fails.
- **CLI — `brain tasks add --verify "<how checked>"`**: stores the verification contract
  as `task.verify`. `brain tasks view` and `brain brief` print it verbatim, or
  `verify: none` when it is absent. `tasks add` without `--verify` adds a `help:` nudge.
- **Harness docs — `.brain/HARNESS.md` §6 "Load-bearing assumptions"**: 11 harness
  components, each with the assumption it encodes, the evidence for it, when it was last
  validated, and how to ablate it. Also a "Scale rigor to the task" section and a
  "When a new model lands" ablation procedure.
- **Harness docs — `.brain/rules/state.md` "What a PASS verification must contain"**:
  independence, every acceptance row walked, binding quality floors, and a receipt that
  names both sides.
- **Harness docs — `.brain/rules/cli-commands.md`**: rules for `receipt` implementer
  tracking and for the `tasks add --verify` contract.
- **Harness docs — `.brain/recipes/99-verify-done.md` §7 "Independent verification"**:
  what the verifier's doc must contain, scaled by plan tier.

### Changed

- **CLI — `brain receipt`**: `--verified-by` now defaults to `git config user.name` (then `$USER`),
  the same identity source as `--implemented-by`'s HEAD-author default. A solo human stamping with
  no flags now trips the self-verified warning instead of silently passing. Sub-agent verifiers
  share the caller's git identity, so they must pass their own `--verified-by`.

- **CLI — `brain check` statuses**: a new **`warn`** status is advisory, and exit stays 0.
  Consumers must treat `warn`, like `skip`, as neither pass nor fail. When only warnings
  are present, `help:` reads "No failing checks" followed by a warning-count line.
  **Potentially breaking** for parsers that assume every row is `pass`, `fail`, or `skip`.
- **CLI — `brain receipt` output**: now prints `verified_by` and `implemented_by`. Every
  warning goes into a single `warning:` key, joined with `; `, and the value is now a
  quoted TOON string. Before, it was an unquoted `warning: recorded with dirty: true …`
  line. **Potentially breaking** for parsers matching the old line.
- **CLI — review dashboard and chrome health strip** (`lib/review/dashboard.js`,
  `lib/review/chrome.js`): `warn` rows are not counted as failing.
- **Playbooks — `verify`**: `use_when` is now "independent, skeptical browser walk of
  every acceptance criterion: golden + error paths, quality floors, screenshot evidence".
  The same text is used in `brain playbook` and in the generated skill.
- **Playbooks — `verify`**: the PASS and FAIL verdict definitions now include acceptance
  rows and quality floors. "Golden path + one error path" is no longer the whole standard.
- **Playbooks — `execute`**: the optional **Auditor** role is replaced by the mandatory
  independent Verifier. Solo work combines Coordinator and Worker in one session but never
  the Verifier. Self-verification is allowed only when no second agent is possible.
- **Skill (`.claude/skills/brain/SKILL.md`)**: the Verifications section, receipt entry,
  `check --strict` entry, and tasks/brief entries now describe the independent-verifier
  model. The regenerated skill passes `brain skill --check`.
- **Harness docs — `.brain/HARNESS.md` §3**: the implementer does not grade its own work,
  implementation runs as a generator → verifier loop, and the definition of done includes
  an independent verification PASS.
- **Harness docs — `.brain/HARNESS.md`, `.brain/recipes/99-verify-done.md`**: the blanket
  `git checkout .brain/` reset is replaced with a file-by-file revert of throwaway test
  writes, because `.brain/` is live state.
- **Harness docs — `.brain/rules/state.md`**: the "neither pass nor fail" rule now covers
  `warn` as well as `skip`.

### Fixed

- **CLI — `brain tasks <verb> --help`**, for example `brain tasks add --help`, now prints
  that verb's help. Before, it printed the list help, which hid every `add` flag.
- **CLI — `brain tasks add --verify ""`** or a whitespace-only value is a usage error
  (exit 2). A hand-edited `tasks.json` with an empty `verify` fails `brain check`'s
  `tasks.json files parse` row.
- **Skill**: restored the phrase "the FROZEN copy the human approved" in the `plans view`
  guidance. The frozen `contract-mockup-snapshot` eval case was red at `107abe4`, and the
  `skill-coverage` suite is back to 37/37.
- **Playbooks — `execute`**: no longer claims `check --strict` warns when `implemented_by`
  is missing. Legacy receipts are `skip`.
