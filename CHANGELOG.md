# Changelog

All notable changes to `brain-axi` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Harness and brain-state
shifts for this repo's own `.brain/` are logged separately in `.brain/CHANGELOG.md`.

## [Unreleased] — 2026-09-30

**Why:** this release separates the evaluator from the generator, following Anthropic's
[Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps).
Work is now graded by a fresh-context verifier that did not write it. The verifier walks
every acceptance criterion against a contract agreed before any code, scores quality
against hard floors, and re-walks in capped fix rounds. The entries below describe the
behavior as it ships; the source of truth for the rules is `.brain/rules/state.md`
("What a PASS verification must contain") and `brain playbook verify`.

### Added

- **Playbooks — `verify`: the independent verification standard.**
  - *Independence.* The verifier is a fresh-context agent that did not write the code,
    declared in the doc header as `- **Independence**: independent — <who>`. Self-verification
    is allowed only when no second agent is possible, declared as
    `- **Independence**: self-verified — <reason>`. A skeptical-stance preamble and a §5c
    CALIBRATION section (good and bad finding examples) set the bar for findings.
  - *Acceptance criteria.* An `## Acceptance criteria` table with one row per criterion: the
    approved plan of record plus every task's `acceptance` and `verify` line. An unwalked row
    blocks a PASS.
  - *Three-layer walk.* Every acceptance criterion, then a golden path plus at least one error
    path, then edge probes (the verdict doc gains an `## Edge probes` table). Any failing row in
    any layer is a FAIL.
  - *Evidence.* A browser walk with screenshots for what a browser can reach. A criterion no
    browser reaches (CLI output, an API response, a file on disk) is checked by running its
    named command, with the command, exit code and observed output as evidence. A CLI-only
    feature runs all three layers as commands (Base URL `n/a — CLI-only`).
  - *Quality scores.* `## Quality scores` on a 0–3 scale, rationale first, with hard floors:
    product-depth 2, functionality 2, design 2 (UI only, otherwise N/A), code-quality 1. Any
    score below its floor, or a stub / display-only control, is a FAIL.
  - *Fix rounds.* Round 1 is `verifications/<YYYY-MM-DD>.md`; round N ≥ 2 is
    `<YYYY-MM-DD>-rN.md` with `- **Round**: N` in the header, exactly one Verdict per doc, a
    fresh verifier each round, and every screenshot `--step` prefixed `rN-` (`shots add`
    overwrites a step's file, so reused names would replace the evidence an earlier round
    cites). Cap 3 rounds, then escalate to the human.
  - *Naming.* `NN-` golden path, `E<N>-` error paths, `A<N>-` acceptance evidence, `X<N>-`
    edge probes.
  - *Receipt.* §6 stamps with both `--verified-by` and `--implemented-by`.
- **Playbooks — `execute`**: a step 1b CONTRACT (each task's `--verify` line is reviewed for
  testability by the verifier before code, then recorded with
  `brain runs append --step "contract agreed"`); a step 4b FIX LOOP (each round records
  refine or pivot before the fix, a fresh verifier re-walks the whole contract in its own
  `-rN` doc, cap 3 then escalate); and a mandatory **Verifier (independent)** role in AGENT
  TOPOLOGY. Rigor scales with the plan tier: **small** gets the contract review plus one fresh
  sub-agent verifier; **full** adds a recommended second adversarial pass on the riskiest tasks.
- **Playbooks — `done`**: §2 checks the newest verification doc (highest round) for three
  things — the verifier was independent, every acceptance row is ✅, no score is under its
  floor — with a matching checklist item.
- **Playbooks — `plan`**: §10 guidance. Acceptance is a testable behavior, each phase carries a
  `Verify:` clause that becomes the task's `--verify`, and the planner stays at product +
  high-level design (no signatures or line-level edits).
- **Playbooks — `write`**: §4.4 states one Verdict per doc; a re-walk is a new `-rN` doc.
- **CLI — `brain receipt --implemented-by <who>`**: records `implemented_by` beside
  `verified_by`, defaulting to the git author of HEAD. The receipt also records where each
  name came from, as `verified_by_source` and `implemented_by_source` (`flag` or `default`).
  Unless both flags are passed, `warning:` includes "identities defaulted — pass
  --verified-by/--implemented-by". When the two names are equal (trimmed, case-insensitive)
  it still stamps and warns.
- **CLI — `brain check --strict`**: a row `every shipped feature was verified independently`.
  It judges each shipped feature on its newest verification doc only (stem order; same-day
  `-rN` rounds sort numerically). `pass` only when the names differ and `verified_by` was
  passed explicitly — a defaulted verifier is `warn` ("identities not declared"). `warn` when
  that doc is not PASS, is self-verified (declared with a reason: "acknowledged"; a bare
  `self-verified` with no reason: "no reason given"; undeclared: "unacknowledged"), names no verifier, or is an
  unstamped PASS behind an older stamped one. `skip` when every receipt predates
  `implemented_by`. The row never fails. Receipts with no source field predate it and are
  judged as before. The full decision table is in `.brain/rules/state.md`, pinned row-for-row
  by `scripts/check-state-invariants.mjs`.
- **CLI — `brain tasks add --verify "<how checked>"`**: stores the verification contract as
  `task.verify`. `brain tasks view` and `brain brief` print it verbatim, or `verify: none` when
  absent. `tasks add` without `--verify` adds a `help:` nudge. An empty or whitespace-only
  value is a usage error (exit 2), and a hand-edited empty `verify` fails `brain check`'s
  `tasks.json files parse` row.
- **Harness docs**: `.brain/HARNESS.md` §6 "Load-bearing assumptions" (11 components, each
  with its assumption, evidence, last validation and ablation), a "Scale rigor to the task"
  section and a "When a new model lands" procedure; `.brain/rules/state.md` "What a PASS
  verification must contain"; `.brain/rules/cli-commands.md` rules for receipt implementer
  tracking and the `--verify` contract; `.brain/recipes/99-verify-done.md` §7 "Independent
  verification".
- **Invariant pins**: `scripts/check-playbook-refs.mjs` pins the `rN-` screenshot prefix, the
  "at least one error path" floor, the "what a browser can reach" scoping in `verify`,
  `execute` and `done`, and the 3-round cap.

### Changed

- **CLI — `brain receipt --verified-by`** now defaults to `git config user.name`, then `$USER`
  (was "the caller"), the same identity source as `--implemented-by`. A solo human stamping
  with no flags now trips the self-verified warning. Sub-agent verifiers share the caller's
  git identity, so they must pass their own `--verified-by`.
- **CLI — `brain check` statuses**: a new advisory **`warn`** status; exit stays 0. Consumers
  must treat `warn`, like `skip`, as neither pass nor fail. With only warnings, `help:` reads
  "No failing checks" plus a warning-count line. **Potentially breaking** for parsers that
  assume every row is `pass`, `fail`, or `skip`.
- **CLI — `brain receipt` output**: prints `verified_by`, `implemented_by` and both source
  fields. Every warning goes into a single quoted `warning:` key, joined with `; ` (was an
  unquoted `warning: recorded with dirty: true …` line). **Potentially breaking** for parsers
  matching the old line.
- **Review dashboard and chrome health strips** (`lib/review/dashboard.js`,
  `lib/review/chrome.js`): both health endpoints (`/session/<key>/health`, `/watch/context`)
  serve `healthChecks()`, which runs **strict** `brainCheck` and tags every strict-only row
  `advisory: true`. Non-strict fails stay red. `warn` rows and strict-only fails go on an amber
  advisory line, with the detail inline and on hover. With any advisory present the ok line
  reads `harness ok · N advisory`, never a plain `harness ok`. `skip` rows stay hidden and are
  not counted.
- **Playbooks — `verify`**: `use_when` is "independent, skeptical walk of every acceptance
  criterion (browser, or the named command where no browser reaches): golden + error paths +
  edge probes, quality floors, screenshot or transcript evidence", shared by `brain playbook`
  and the generated skill. The PASS/FAIL definitions now include acceptance rows, edge probes
  and quality floors.
- **Playbooks — `execute`**: the optional Auditor role is replaced by the mandatory independent
  Verifier. Solo work combines Coordinator and Worker in one session, never the Verifier.
- **Skill (`.claude/skills/brain/SKILL.md`)**: the Verifications, receipt, `check --strict`,
  tasks and brief entries describe the independent-verifier model; the layout block names
  `-rN` docs and screenshot prefixes.
- **Harness docs — `.brain/HARNESS.md` §3**: the implementer does not grade its own work,
  implementation runs as a generator → verifier loop, and the definition of done includes an
  independent verification PASS. The blanket `git checkout .brain/` reset in `HARNESS.md` and
  `99-verify-done.md` is replaced with a file-by-file revert of throwaway writes, because
  `.brain/` is live state. `state.md`'s "neither pass nor fail" rule covers `warn` as well as
  `skip`.

### Fixed

- **CLI — `brain tasks <verb> --help`** (for example `brain tasks add --help`) prints that
  verb's help. Before, it printed the list help, which hid every `add` flag.
- **Skill**: restored the phrase "the FROZEN copy the human approved" in the `plans view`
  guidance. The frozen `contract-mockup-snapshot` eval case was red at `107abe4`; the
  `skill-coverage` suite is back to 37/37.
