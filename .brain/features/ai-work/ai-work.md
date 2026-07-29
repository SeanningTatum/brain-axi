# Feature: ai-work — AI-aware harness (evals, golden sets, prompt review)

_Last updated: 2026-07-28_

## Purpose

The harness assumes deterministic code: a check passes or fails, a diff means what it says. AI work breaks both assumptions — a prompt edit has no compiler, no failing test, and no way to tell "better" from "different." This feature makes `.brain/` inclusive of AI work: a standing `ai` playbook that turns prompt/model/agent work into a checkable loop, AI branches in the existing bookends so that loop is enforced at kickoff and at done, and (later phases) an evals subsystem holding golden sets, run history, a regression gate, and a human review surface for prompts and eval output.

## When It's Used

- Agent runs `brain playbook ai` before planning or editing any prompt, model call, chain, retrieval step, or agent.
- `brain playbook plan` §13 fires when a plan touches AI, requiring prompt contract + eval plan + regression gate + agent topology.
- `brain playbook start` §3/§5 — read `.brain/evals/` state and take an eval baseline before editing.
- `brain playbook execute` step 3b — every prompt change re-runs the suite and records a per-case delta.
- `brain playbook done` §2b — the gate: suite re-run, no failing frozen case, bugs encoded as frozen cases, human feedback answered.

## How It Works

**Phase 1 (shipped)** is text-only: `PLAYBOOKS.ai` in `lib/review/playbooks.js` carries the full standard, four existing playbooks gain skip-guarded AI branches pointing back at it, and `skillContent()` carries the condensed version so skill-only agents get the same contract.

**Phase 2 (shipped)** adds the data layer in `lib/review/evals.js`: suites under `.brain/evals/<suite>/` (`suite.json` + `cases.jsonl` + `runs.jsonl` + `runs/<ts>.json`), strict-where-it-matters validation (unique case ids, an input to feed, a runner that exists), `brain evals` / `view` / `cases` / `runs`, four new `brain check` rows (suites parse, cases+runs parse, prompt pointers resolve, run files exist), and an `evals/index.md` in the `brain init` scaffold. Suite state is computed, not stored: `never-run` / `stale` (a prompt pointer's mtime is newer than the last run) / `regressed` / `ok`.

**Phase 3 (shipped)** adds execution and the gate: `brain evals run` spawns the suite's declared shell runner from the repo root and reads one JSON envelope off stdout; `brain evals record --from <file> --adapter promptfoo|envelope` ingests a run produced elsewhere; `scoreRun` joins results to the golden set (unreported cases fail — silence is not a pass; invented ids mark the run `partial`); `gateVerdict` applies the locked policy (frozen cases hard-fail, `min_pass_rate`, aggregate tolerance band, "baseline established" on a first run); `recordRun` writes the full per-case record plus a `runs.jsonl` summary with `usage` and `trace_url`; `brain verify --stage evals` runs every suite through the gate and exits 1; `brain progress add --eval <suite>` stamps the checkpoint with the score, delta, frozen failures and cost read out of the run record; the home dashboard grows an `evals:` line naming any suite needing attention.

Later phases (planned, per `plans/2026-07-28-ai-work-harness.html`):

- **Phase 4** — `brain evals review <suite>`: generated run artifact (prompt + per-case cards, failures first) in the existing review server; annotations persist as `feedback/<date>.md`.
- **Phase 5** — prompt registry (`brain prompts`) tying a prompt edit to the suite that must re-run.
- **Phase 6** — agent topology state: `.brain/agents/agents.json` roster (role, model, tools, ownership, handoff, escalation, optional `impl` pointer) + per-plan assignment + `progress add --agent`.
- **Phase 7** — portability proof: the whole loop runs in `cf-saas-react-router-starter` (promptfoo + langchain) with zero brain-axi source changes.

### Persistence details

- Phase 1: none — playbook text is code, and the generated skill is the only artifact written (`.claude/skills/brain/SKILL.md`).
- Phase 2+: `.brain/evals/<suite>/` (committed in full, including per-case outputs, with a `max_output_chars` truncation cap); `.brain/agents/agents.json`.

### Testability

No test framework in this repo — verification is invoking the CLI and reading TOON. Phase 1: every playbook renders (`brain playbook <id>` exit 0), the index lists six, `brain skill --check` is clean. Phase 3 adds the real test: deliberately degrade a prompt and confirm the gate exits 1 naming the failing frozen case.

## Key Files

| File | Role |
|------|------|
| `lib/review/playbooks.js` | `PLAYBOOKS.ai` + AI branches in `plan` §13, `start` §3/§5, `execute` 3b, `done` §2b |
| `lib/review/evals.js` | Eval data layer: loaders, validation, adapters, scoring, recording, the gate |
| `bin/brain.js` | `cmdEvals` (+ `run`/`record`/`golden`), `cmdVerifyEvals`, `progress add --eval`, home eval line, `initEvalsIndexMd`, `skillContent()` |
| `.brain/evals/skill-coverage/` | The dogfood suite — 31 cases, 28 frozen, scoring the generated skill |
| `scripts/eval-skill-coverage.mjs` | Reference runner: the envelope contract in ~70 lines, no deps, no model call |
| `.brain/rules/ai-work.md` | Layer rule for this surface — code layout, invariants, update triggers |
| `plans/2026-07-28-ai-work-harness.html` | Plan of record, reviewed 2 rounds |

## Dependencies

- `core-cli` — command dispatch, TOON output, `help:` lists
- `harness-mode` — `verify.json` registry + stage model the `evals` stage extends; the start/done bookends the AI branches hook into

## Errors

Phase 1 introduces no new error paths. Planned (phase 3):

| Error | Where raised | Surfaces as |
|-------|--------------|-------------|
| Runner exits non-zero / non-JSON | `brain evals run` | `opError` with the command + stderr tail; no partial run recorded (exit 1) |
| Adapter cannot parse vendor output | `brain evals record` | Named error (adapter, file, missing field) + `--adapter envelope` escape hatch (exit 1) |
| Frozen regression case failing | `brain verify --stage evals` | Gate fails hard regardless of aggregate; failing ids listed (exit 1) |
| Unknown agent role assigned in a plan | `brain check` | Failing row naming the unknown role and the known ones (exit 1) |

## Changelog

| Date | Type | Description |
|------|------|-------------|
| 2026-07-28 | feature | Phase 1: `brain playbook ai` + AI branches in plan/start/execute/done + skill "AI work" section + `rules/ai-work.md` |
| 2026-07-29 | feature | Phase 2: `lib/review/evals.js` data layer, `brain evals` read verbs, 4 new `brain check` rows, `evals/index.md` in `brain init`, dogfood suite (31 cases) |
| 2026-07-29 | feature | Phase 3: `evals run`/`record` (+ promptfoo adapter), `golden add`/`freeze`, `brain verify --stage evals` gate, `progress add --eval`, home eval line |
