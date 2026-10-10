---
name: brain-done
description: "Use before declaring any task complete, opening a PR, or shipping a feature — full brain verify, brain check, doc coherence for every changed path, then close state: checkpoint, ship with evidence, record the PR."
---
TERMINATION CHECK PLAYBOOK
==========================

You are about to declare a task complete. This is the bookend that closes the
state the `brain-start` skill (`brain playbook start` if skills are unavailable) opened — full verify, harness invariants, and a
brain-coherence pass, before a single "looks done to me" claim leaves this
session. The rule this playbook exists to enforce, ported from the execution
loop (the `brain-execute` skill (`brain playbook execute` if skills are unavailable)): every claim below is something you actually
ran and read back, never something you expect to be true. A red row you
didn't look at is not a passed check — it's an unchecked one.

-------------------------------------------------------------------------------
1. FULL VERIFY
-------------------------------------------------------------------------------

    brain verify --feature <slug>

Runs every declared project check (the full `verify` stage — typecheck,
tests, lint, e2e, whatever `.brain/verify.json` registers). Every row must be
green. On a failure:

- Fix the underlying problem.
- Re-run just that check: `brain verify --only <name>`.
- Never declare the task done with a red row still showing — "it'll probably
  pass on the next run" is not a result.

Pass `--feature <slug>` (when this task is scoped to a tracked feature) so
the final green run is appended as a run-note step under that feature — real
verbatim output, not a paraphrase, landing as evidence for step 5.

-------------------------------------------------------------------------------
2. FEATURE VERIFICATION FOR USER-VISIBLE WORK
-------------------------------------------------------------------------------

If this task shipped or changed user-visible behavior, it needs a
verification doc from an independent verifier: every acceptance criterion
walked, golden path + at least one error path + edge probes — driven in a
real browser for what a browser can reach, each non-browser criterion run as
its named command — screenshots (or command + exit code + output), quality
scores against their floors, a Verdict line. That full standard lives in
the `brain-verify` skill (`brain playbook verify` if skills are unavailable) — read and follow it there; this playbook does not
duplicate it. Confirm it landed with `brain verifications <slug>`, then open
the newest doc — the highest round (`<date>-rN.md` is newer than
`<date>.md`) — and hold three:

- **It was independent.** Its `- **Independence**:` line names a
  fresh-context verifier that did not write the code — or reads
  `self-verified — <reason>` with a reason that holds (no second agent was
  possible), not a convenience. You grading your own work here is exactly
  the leniency this step exists to catch; if that is what happened, spawn a
  verifier now rather than declaring done.
- **Every acceptance row is ✅.** One row per plan-of-record and task
  acceptance criterion, none ❌, none quietly missing. A row that failed and
  was fixed needs a later round that re-graded it (`- **Round**: N`), not
  your note that it is fixed now.
- **No quality score sits under its floor.** Product depth, functionality,
  design ≥ 2 (design N/A for non-UI work); code quality ≥ 1. Below a floor is a FAIL whatever the Verdict
  line says. Round 3 still failing is an escalation to the human, not done.

Pure internal refactor / no user-visible surface changed? Skip this step —
but say so explicitly in your final report rather than silently omitting it.

-------------------------------------------------------------------------------
2b. AI WORK — EVAL GATE, GOLDEN CASES, HUMAN FEEDBACK
-------------------------------------------------------------------------------

Skip if this task touched no prompt, model, chain, retrieval, or agent. If it
did, run

    brain verify --stage evals

and hold all four of the following — read the `brain-ai` skill (`brain playbook ai` if skills are unavailable) for the
reasoning:

- **The suite was re-run after your LAST edit**, not three edits ago. Report
  the real before/after numbers, not "it improved." `brain evals` marks a
  suite `stale` when a prompt it points at changed after the last run.
- **No frozen regression case is failing.** These are absolute: a red frozen
  case blocks done regardless of how the aggregate moved, and the aggregate
  must be inside its tolerance band rather than merely "close."
- **Every bug you fixed this session exists as a new frozen case** in the
  golden set (`brain evals golden add ... --frozen`, or
  `brain evals golden freeze <suite> <case-id>`). Fixing a failure without
  encoding it means the next prompt rewrite is free to reintroduce it, and it
  will.
- **Human feedback on eval output has been answered.** If a human commented on
  prompts or eval results and nothing changed in the prompt OR the golden set
  in response, the loop is open and the task is not done. Answering means a
  concrete change or an explicit, written "not doing this, because —" — not
  silence.

No suite exists for the prompt you changed? Say that plainly in the final
report as a known gap. Do not report the change as verified.

-------------------------------------------------------------------------------
2c. PRODUCT CLAIMS — STILL TRUE?
-------------------------------------------------------------------------------

Skip if the approved plan had no product brief (internal work). Otherwise hold three claims — the success metric actually observed, the non-goals held, the shipped UI matching the approved mockups. Read `references/product-claims.md` (`brain playbook done --ref product-claims`) before skipping this step.

-------------------------------------------------------------------------------
3. HARNESS INVARIANTS
-------------------------------------------------------------------------------

    brain check

Every row must pass — feature-list validity, the one-in-progress policy, doc
paths resolving, dependency refs, plan/review file integrity, verification
docs having a Verdict line. Exits 1 on any failure. Fix and re-run; do not
report done over a failing `brain check`.

-------------------------------------------------------------------------------
4. BRAIN COHERENCE
-------------------------------------------------------------------------------

For every path your diff touched, name the brain doc that owns it (a rules
doc, a codebase doc, the feature's own `<slug>.md`) and confirm it still
describes reality:

- Changed how something behaves or is structured? The owning rules/codebase
  doc should say so now, not what it said before you started.
- Changed a tracked feature's behavior? Its `<slug>.md` should reflect that
  change.

Flag, explicitly, any changed path whose owning doc you did NOT update — do
not let it pass silently as "probably fine."

-------------------------------------------------------------------------------
5. CLOSE STATE
-------------------------------------------------------------------------------

Everything written in this step follows the `brain-write` skill (`brain playbook write` if skills are unavailable) — it owns the
slots and the register for each artifact below.

- Final step of record: `brain runs append <slug> --step "..." --observed
  "..."` — the last verbatim entry in this task's deep run-note record.
- Checkpoint: `brain progress add --summary "<what shipped>" --next "<what's
  next, if anything>"` — closes the rolling cursor for this session.
- Feature actually done, not just this task? `brain ship <slug> --evidence
  "<from real output — a verify result, a verdict line>"` — this single
  command flips status to shipped, checkpoints, and runs `brain check` itself,
  so parts of steps 3 and 5 above happen again as part of shipping. Never
  compose `--evidence` from a sentence you made up to satisfy the flag.

-------------------------------------------------------------------------------
6. DEFINITION OF DONE — restated
-------------------------------------------------------------------------------

A task is done only when ALL of the following are true, not "mostly true":

- [ ] Implementation matches the task as framed at kickoff
      (`brain playbook start`)
- [ ] `brain verify` green — every declared check, not just the ones you
      remembered to run
- [ ] Feature verification doc produced, if user-visible work — or
      explicitly marked N/A with a reason
- [ ] That verification was independent (fresh-context verifier), or
      declared `self-verified — <reason>`; every acceptance row ✅; no
      quality score under its floor
- [ ] AI work only: suite re-run after the last edit, no frozen case failing,
      every fixed bug encoded as a new frozen case, human eval feedback
      answered — or the whole block explicitly marked N/A
- [ ] User-facing work only: the plan's success metric observed (or its
      measurement date named), non-goals held, and shipped UI reconciled
      against the approved mockups — or explicitly marked N/A
- [ ] `brain check` — all harness invariants pass
- [ ] Every changed path's owning brain doc updated, or explicitly flagged as
      not
- [ ] Feature status flipped (`brain ship` / `set-status`) if the feature
      itself is done
- [ ] Run note closed, progress checkpoint written

If anything above is unmet, do not declare the task done — say exactly what's
blocking instead. A partial "done" reported as complete is worse than an
honest "blocked on X."

## Next

- Terminal — nothing follows. The task is closed once state is recorded.
- While recording checkpoints, evidence, and the PR, use the `brain-write` skill.
