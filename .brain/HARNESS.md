# HARNESS.md — The harness, explained

> One-stop explainer for *what holds this project together for AI agents*. Read this once when joining the repo. Update it when the harness itself changes (not when features change — that's `.brain/features/`).
>
> **This describes `brain-axi` itself** — the zero-dependency Node CLI whose job is to query/update `.brain` harnesses in *other* repos. Here the harness is turned on itself: this `.brain/` documents `brain-axi`'s own code.

## What is the harness?

The **harness** is the system *around* the LLM that makes coding agents reliable across sessions. It is not the model, the prompt, or the codebase — it is the scaffolding that keeps agents from forgetting context, drifting from conventions, breaking unrelated code, or stopping at "compiles but wrong."

This repo follows the **5-subsystem framework**:

```
1. Instructions   →  what to read before working
2. State          →  what's done, in progress, where I left off
3. Verification   →  how to prove a change is correct
4. Scope          →  what counts as "this task" (and what doesn't)
5. Lifecycle      →  bootstrap, session handoff, clean restart
```

Every concrete artifact below maps to one of those five. §6 then records the assumption each one encodes and how to test whether it is still needed.

---

## 1. Instructions — the reading list

Layered from generic to specific.

| File | Purpose |
|------|---------|
| [`/CLAUDE.md`](../CLAUDE.md) | Repo root pointer: what brain-axi is, the `.brain`-is-now-real-not-fixture note, invariants, verify-by-running rule. |
| [`.brain/codebase/`](codebase/) | Programming model — Node ESM, zero deps, TOON encoder, flag parsing, error model, command anatomy. |
| [`.brain/high-level-architecture/`](high-level-architecture/) | Macro view — CLI layering top-to-bottom in `bin/brain.js`, and the `brain review` server/chrome/SDK three-process model. |
| [`.brain/rules/`](rules/) | Layer-aligned do/don't rules — TOON+AXI output, CLI command anatomy, review server (trust boundary), review browser (sandbox/postMessage). |
| [`.brain/recipes/`](recipes/) | Deterministic runbooks — bookended by `00-before-task.md` and `99-verify-done.md`. |
| [`.brain/features/`](features/) | One MD per shipped/in-progress feature (purpose, runtime flow, key files, changelog). |

**Reading rule**: *retrieval over recall*. Open the matching `index.md` first; it tells you which file(s) apply. Do not rely on training data for project patterns. The single most important external reference is [`docs/REVIEW-ARCHITECTURE.md`](../docs/REVIEW-ARCHITECTURE.md) — the binding contract for `brain review`.

---

## 2. State — what is true right now

| File | Purpose | Update cadence |
|------|---------|----------------|
| [`features/feature_list.json`](features/feature_list.json) | Machine-readable feature status, dependencies, evidence. Source of truth for "what's in flight." | On every status change |
| [`runs/progress.md`](runs/progress.md) | Rolling session cursor — newest entry on top, ≤5 lines per checkpoint. Read at session start. | Each meaningful checkpoint |
| [`runs/<YYYY-MM-DD>-<slug>.md`](runs/) | Per-task deep state — baselines, dead ends, decisions, verbatim CLI output | During the task |
| [`CHANGELOG.md`](CHANGELOG.md) | High-level architectural / brain shifts (NOT code changelog — `git log` is) | On architectural change |
| `features/<slug>/<slug>.md` "Changelog" table | Per-feature behaviour changes | On every behavior change to feature |

**Two-layer rule**: `progress.md` is "where am I right now"; `runs/<slug>.md` is "everything I learned doing this task." First is read at session start, second when continuing a specific task.

---

## 3. Verification — proving a change is correct

There is **no test framework, no build step, no lint config** in this repo. Verification = **invoke the affected command against `.brain/` and eyeball the result.**

| Tool | Purpose |
|------|---------|
| [`recipes/99-verify-done.md`](recipes/99-verify-done.md) | Full checklist: run affected command → check exit code (`echo $?`) → eyeball TOON on stdout → confirm stderr is diagnostics-only → `brain skill --check` → revert throwaway test writes only → brain coherence → independent verification doc |
| `node bin/brain.js <cmd> --brain .brain` | Run any command against the local brain (this dir). Force `--brain .brain` so it doesn't walk up. |
| `node bin/brain.js skill --check` | Exits 1 on skill/CLI drift. The closest thing to a CI gate. |
| Browser walk (review only) | For `brain review` changes: `node lib/review/server.js`, open a session, exercise annotate/composer/SSE. Never claim the review UI works without opening the browser. |

**Verification rule**: exit 0 + clean TOON is *necessary, not sufficient* for UI. `brain review` changes need a real browser walk — the iframe sandbox, postMessage, and SSE only break at runtime. Write commands (`set-status`, `progress add`, `ship`, `runs append`) mutate files, and **`.brain/` is live state, not a fixture**: revert only the throwaway writes you made to test a command (`git checkout -- <that file>`), never a blanket `git checkout .brain/` that would discard real checkpoints, run notes, or verdicts.

**The implementer does not grade its own work.** A feature's verification doc is written by an **independent, fresh-context verifier** — an agent that did not write the code, declared in the doc's `- **Independence**:` header (self-verification only when no second agent is possible, with the reason stated). It walks **every** acceptance criterion — the approved plan of record's phases plus each task's `acceptance` / `--verify` line — as a row of the doc's `## Acceptance criteria` table, scores `## Quality scores` against floors (below a floor, or a stub / display-only surface, = FAIL), and the receipt records `implemented_by` beside `verified_by`. Same identity is advisory, never a refusal: `brain receipt` adds a `warning:` and `brain check --strict` marks the row `every shipped feature was verified independently` as `warn` (exit stays 0; `skip` for receipts predating `implemented_by`). Implementation runs as a **generator → verifier loop**: a contract first (each task proposes its `--verify` check; the verifier reviews testability before code), then fix rounds with a fresh verifier each round, capped at 3 before escalating to the human. The procedure lives in `brain playbook execute` (contract, loop, rounds) and `brain playbook verify` (what a verdict must contain) — do not restate it here. Rigor scales with the plan tier; see §6.

---

## 4. Scope — task boundaries

What counts as "this task" — and what doesn't.

- **One in-progress feature at a time.** Source: `feature_list.json` `status: "in-progress"` count must be 1 (enforced by `policy.one_in_progress_at_a_time` and `brain check`).
- **Definition of done**: impl complete + verify-done green + independent verification PASS (every acceptance row, quality floors met) + feature MD updated + `feature_list.json` flipped + `brain skill --check` green + run note closed.
- **`brain review` file ownership** (from REVIEW-ARCHITECTURE addenda): server.js/store.js/brain-data.js/playbooks.js/bin/brain.js vs sdk.js vs chrome.html/chrome.js are split workstreams. Respect the split — do not cross-edit modules you don't own in a given task.
- **Anti-creep heuristic**: if you find yourself "while I'm here…" touching a command unrelated to the diff, stop. Open a new task.

---

## 5. Lifecycle — session management

Bootstrap, handoff, recovery.

| Step | Tool |
|------|------|
| Session start | SessionStart hook runs `brain context` (silent no-op outside a brain repo) |
| Project bootstrap | none needed — zero deps, no build. `node bin/brain.js` runs directly (`node >=18`). |
| Baseline before edit | `node bin/brain.js <affected cmd> --brain .brain` — capture current good output |
| Task framing | [`recipes/00-before-task.md`](recipes/00-before-task.md) |
| Mid-task checkpoint | `brain progress add --summary "..."` (or append to [`runs/progress.md`](runs/progress.md)) |
| Task done | [`recipes/99-verify-done.md`](recipes/99-verify-done.md) — full checklist |
| Ship a feature | verify-done + `brain ship <slug> --evidence "..."` (flips status, checkpoints, runs `brain check`) + update feature MD |
| Architectural shift | Append to [`CHANGELOG.md`](CHANGELOG.md) |

---

## 6. Load-bearing assumptions — what each component bets the model can't do

Not a sixth subsystem, but an audit that sits over the five. Every component above encodes an assumption about what the model can't do on its own. Those assumptions can be wrong from the start, and they go stale as models improve. A component nobody has tried removing is a claim, not a finding. This table is where that claim gets written down, along with how to test it.

"Last validated" means **ablated**: the component was removed for a trial and the effect was measured. Nothing here has been ablated yet. Where the Evidence column cites something, it is an observation made with the component in place. That shows the component catching real problems. It does not show that removing it would change the outcome.

| Component | Assumption it encodes (what the model can't do alone) | Evidence it's load-bearing | Last validated on (model, date) | How to ablate |
|---|---|---|---|---|
| SessionStart context hook (`brain context`) | Won't go and read project state at session start unless the state is injected. Starts from priors and re-does finished work. | **None measured.** Nothing compares sessions with and without the hook. | Not yet ablated. Introduced 2026-07-13 (`c1b0880`), assumed on claude-opus-5 | Remove the hook for a few sessions. Record whether the agent's first actions still read `brain progress` / `brain features`, and whether it repeats closed work |
| `progress.md` cursor + run notes | Can't carry decisions, dead ends, or "next" across context resets and sessions. | Observational. The seven state-integrity review rounds (2026-07-31 → 08-01) each resumed from the cursor's `next:` line, and each round's findings are in `features/state-integrity/runs/2026-07-31-progress.md`. No run without the cursor exists to compare. | Not yet ablated. Introduced 2026-07-14, assumed on claude-opus-5 | Run one multi-session task without reading the cursor. Count re-derived decisions and repeated dead ends against the run note |
| One-in-progress policy (`policy.one_in_progress_at_a_time`) | With several features open, spreads effort thin and calls partial work done. | **Structural only.** Its two implementations drifted apart twice (CHANGELOG, phase 2), which shows the rule was hard to enforce, not that it matters. `ai-work` was blocked to free the slot (progress, 2026-07-31). Since task-coordination it binds features only, and tasks under a feature run in parallel. | Not yet ablated. Assumed since 2026-07-14 on claude-opus-5 | Allow two in-progress features for one session. Check whether either ships with unverified acceptance rows |
| Plan review by a human (`brain review`, `reviews.jsonl`) | Can't pick product scope and expensive-to-reverse decisions to the human's taste. | **Weak, and partly contrary.** The plan-phase verification (2026-08-10) records 0/13 and then 0/7 decisions landing off the recommendation, so the human took every default in both measured rounds. The memory check in the same round did remove 3 of 7 cards and surface a missing one. 9 plans carry `reviews.jsonl`. | Not yet ablated. Assumed since 2026-07-16 on claude-opus-5 | Best ablation candidate. Skip review for **small**-tier plans for a stretch, then count decisions reversed after build against the reviewed full-tier plans |
| Contract step (task proposes `--verify`; verifier reviews testability before code) | Implementer and verifier otherwise disagree on what "done" means, and untestable tasks get written. | **None yet.** Introduced in this change. | Not yet ablated. Introduced 2026-09-29, assumed on claude-opus-5 | Run a feature's tasks without `--verify` proposals. Count verifier findings of the form "criterion not checkable", and count rework |
| Independent verifier (fresh-context agent, `- **Independence**:` header) | Grading its own work, the model is lenient. It praises mediocre output and misses its own regressions. | **Strongest in the repo, though observational.** Every separate-agent review of state-integrity (phases 2–7) found P0 or P1 defects the author missed, some of them regressions the author introduced (CHANGELOG 2026-07-31 → 08-01). A pre-PR Greptile review of plan-phase found 2 defects that all 4 declared gates passed (`plan-phase/verifications/2026-08-10.md`). The task-coordination CAS race was found by a worker agent, not by its author. | Not yet ablated. Observed on claude-opus-5, 2026-07-31 → 08-10; formalized as a rule 2026-09-29 | On a sample of tasks, have the implementer self-verify and a fresh verifier re-verify blind. Compare verdicts and finding counts |
| Fix-loop round cap (3, then escalate; refine vs pivot recorded) | Loops without converging, or keeps refining when it should pivot, and burns cost. | **One arc, and it's a guess.** State-integrity's scores went 4 → 5 → 6 → 7 → 7 → 6.5 → 7.0 and plateaued after about round 4, when the reviewer called STOP (progress, 2026-07-31). The cap of 3 is an extrapolation from that single arc. | Not yet ablated. Introduced 2026-09-29, assumed on claude-opus-5 | Log rounds-to-PASS in every run note. If features routinely pass in rounds 1–2, the cap never binds. If round-3 escalations turn out trivial, raise it |
| Quality floors (product-depth / functionality / design / code-quality, 0–3, floors 2/2/2/1) | Binary checks let "technically works" through, including stubs and display-only surfaces. The model needs graded criteria to reach depth. | **None in this repo.** The floor values come from the post's approach and have not been calibrated against a single brain-axi verification. | Not yet ablated. Introduced 2026-09-29, assumed on claude-opus-5 | Score past PASS verifications retroactively and see whether any floor would have flipped one. Track per-criterion scores: a floor nothing ever trips is set too low or measures nothing |
| Receipt / commit binding (`brain:verification`, `implemented_by` vs `verified_by`) | Will cite a verdict against code that has since moved, and will not notice when the author and the verifier are the same agent. | Observational. Receipts made verdicts falsifiable, and HEAD or branch receipts had bound nothing (CHANGELOG phases 3, 6). The plan-phase receipt had to be re-stamped after the review fixes (`107abe4`), so the binding forced a fresh claim. `implemented_by` is new here, and its value is unknown. | Not yet ablated. Introduced 2026-07-31; `implemented_by` 2026-09-29; claude-opus-5 | Count ship refusals for a stale or non-ancestor receipt, and count same-author warnings. If both stay at zero over many ships, the binding is documentary |
| `verify.json` checks (`brain verify`) | Won't re-run the whole-repo invariants after a local change. "My edit was small" is how drift lands. | `brain metrics` on 2026-09-29 (main checkout; `gates.jsonl` is per-machine): **39 verify runs, 156 gate executions, 2026-08-01 → 2026-09-29, first-pass 97.4%.** `harness` caught **1/39 (2.6%)**, on 2026-08-06 at `d4818d8`. `skill-sync`, `playbook-refs`, and `state-invariants` each caught **0/39 (0%)**. Caveat: failures fixed during development, before `brain verify` runs, never reach the log, so 0% means "never caught at the gate", not "never useful". | Not yet ablated. Introduced 2026-07-23 → 07-31, claude-opus-5 | For each 0% check, run a **mutation**: break the thing it names and confirm it goes red (the `rules/state.md` fixture rule). A check that stays green under mutation gets rewritten or cut |
| Eval gate (`brain verify --stage evals`, `skill-coverage` suite) | Can't judge whether its own prompt or skill edits regressed. | Observational. The first `skill-coverage` run (2026-07-29, `bc63b0b`) scored 27/31, with 4 frozen cases red (`cmd-evals`, `cmd-context`, `cmd-setup`, `cmd-skill`), and those were fixed in the next run. The 14 of 15 runs since have had no failing frozen case. The stage is opt-in and not part of the default `verify`. | Not yet ablated. Introduced 2026-07-29, claude-opus-5 | Drop a command from `skillContent()` and confirm its frozen case goes red. Then note how often the stage is run at all, since an opt-in gate nobody runs is not a gate |

### Scale rigor to the task

An evaluator is worth its cost only when the task sits beyond what the current model does reliably on its own. Tie rigor to the plan tier (`brain playbook plan`):

- **small** tier: the declared `verify.json` checks, the contract review (one `--verify` line per phase/task), and a single fresh sub-agent as verifier over every acceptance row. On FAIL the fix loop still runs (fresh verifier per round, cap 3).
- **full** tier (cross-layer, user-facing, or expensive to reverse): the same, with an independent verifier on the whole contract → verify → fix loop, and a second adversarial pass on the riskiest tasks recommended.

Quality floors apply in both tiers (design is N/A for non-UI work). The tier changes how many verifier passes you buy, never whether the author grades its own work. The procedure is `brain playbook execute` (AGENT TOPOLOGY).

The tier line moves when a model improves. Something that needed the full loop last model may be small-tier work now, and the ablation results above are what justify moving it.

### When a new model lands

1. **Re-read traces before touching anything.** Read the latest run notes, verification docs, and `brain metrics`, and find where the harness actually intervened.
2. **Ablate one component at a time**, starting with the rows whose evidence is weakest (context hook, plan review on small tier, round cap). Run a representative task with only that component removed. Never remove two at once, or the result can't be attributed to either.
3. **Record the outcome in this table.** Update Evidence and "Last validated on", and write the result even when it is "no measurable effect". Add a `brain` row to [`CHANGELOG.md`](CHANGELOG.md) naming the component, the model, and the decision (kept, lightened, or removed).
4. **Strip what isn't load-bearing** and keep what is. A component that made no difference on this model is cost with no benefit. Put it back only when a trace shows the failure it guarded against.

---

## Project non-negotiables (recap from CLAUDE.md)

1. **stdout = TOON payload only; stderr = diagnostics/banners.** Agents parse stdout — never `console.log` free text to stdout.
2. **Every command result ends with a `help:` next-step list.** This is AXI contextual disclosure — the tool teaches through its output.
3. **Zero runtime dependencies. Node ESM, `node >=18`. No build step, no `src/`, no bundler, no test framework.** The whole CLI is `bin/brain.js`; `brain review` adds `lib/review/*` (also zero-dep).
4. **The generated skill (`skillContent`) stays in sync with real commands.** `brain skill --check` exits 1 on drift (CI gate). Change a command → update `skillContent()`.
5. **`brain review` security invariants:** loopback bind only; iframe sandbox never `allow-same-origin`; normalize/whitelist every browser-supplied object at the trust boundary; same-origin guard on browser POSTs; injected SDK tag is the only artifact mutation.

Full detail: [`codebase/index.md`](codebase/index.md).

---

## When you change the harness itself

Editing this file, hooks, `feature_list.json` schema, the `.brain` layout, or adding/removing a harness component (also add or strike its §6 row) → append a row to [`CHANGELOG.md`](CHANGELOG.md) under "Brain / harness shifts." Bump the date in [`features/feature_list.json`](features/feature_list.json) `updated` field.

## Further reading

- [`docs/REVIEW-ARCHITECTURE.md`](../docs/REVIEW-ARCHITECTURE.md) — binding contract for `brain review` (shapes, HTTP API, security invariants, all addenda).
- [`.claude/skills/brain-axi/SKILL.md`](../.claude/skills/brain-axi/SKILL.md) — the `brain-axi` skill: AXI ergonomic standards for agent-facing CLIs. Read before changing any agent-facing surface.
- [Anthropic — Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents/) — origin of the 5-subsystem framing: progress cursor, one feature at a time, verify before done.
- [Anthropic — Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps) — the generator/evaluator split, sprint contracts, graded quality criteria, and the principle behind §6: every component encodes an assumption about what the model can't do on its own, and those assumptions go stale as models improve.
