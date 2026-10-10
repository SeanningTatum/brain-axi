---
name: brain-done
description: "Use before declaring any task complete, opening a PR, or shipping a feature — full brain verify, brain check, doc coherence for every changed path, then close state: checkpoint, ship with evidence, record the PR."
---
> CLI note: examples below say `brain <cmd>`. If `brain` is not on PATH, run `npx -y brain-axi <cmd>` instead.

TERMINATION CHECK
=================

You are about to declare a task complete. This is the bookend that closes the
state the `brain-start` skill opened — full verify, brain integrity, and a
brain-coherence pass, before a single "looks done to me" claim leaves this
session. The rule this skill exists to enforce, ported from the execution
loop (the `brain-execute` skill): every claim below is something you actually
ran and read back, never something you expect to be true. A red row you
didn't look at is not a passed check — it's an unchecked one.

-------------------------------------------------------------------------------
1. FULL VERIFY
-------------------------------------------------------------------------------

    brain verify run --feature <slug>

(bare `brain verify` does the same; omit `--feature` for work not tied to a
feature.) Runs every declared project check — typecheck, tests, lint, e2e,
whatever `brain verify list` shows. Read the results table: every row must be
green; the command exits 1 if any fails, and `NO_CHECKS` (exit 1) means no
checks are declared — declare real ones first with `brain verify add`. On a
failure:

- Fix the underlying problem.
- Re-run just that check: `brain verify run --only <name>`.
- Never declare the task done with a red row still showing — "it'll probably
  pass on the next run" is not a result.

With `--feature <slug>` the gate rows are attributed to that feature. Log the
final green output verbatim as evidence for step 5:
`brain runs append <slug> --step "brain verify run" --observed -` (pipe the
output on stdin) — real output, not a paraphrase.

-------------------------------------------------------------------------------
2. FEATURE VERIFICATION FOR USER-VISIBLE WORK
-------------------------------------------------------------------------------

If this task shipped or changed user-visible behavior, it needs a
verification from an independent verifier: every acceptance criterion walked,
golden path + at least one error path + edge probes — driven in a real
browser for what a browser can reach, each non-browser criterion run as its
named command — screenshots (or command + exit code + output), quality scores
against their floors, a Verdict line. That full standard lives in the
`brain-verify` skill — follow it there; this skill does not duplicate it.
Confirm it landed with `brain verifications list --feature <slug>`, then
`brain verifications view <slug> --full` (latest round) and hold four:

- **It was independent.** The body's `- **Independence**:` line names a
  fresh-context verifier that did not write the code — or reads
  `self-verified — <reason>` with a reason that holds (no second agent was
  possible), not a convenience; `verified_by:` and `implemented_by:` should be
  two different parties. You grading your own work here is exactly the
  leniency this step exists to catch; if that is what happened, spawn a
  verifier now rather than declaring done.
- **Every acceptance row is PASS.** One row per plan-of-record and task
  acceptance criterion, none failing, none quietly missing. A row that failed
  and was fixed needs a later round that re-graded it (`round:` higher), not
  your note that it is fixed now. `verdict:` is `PASS` on the LATEST round.
- **No quality score sits under its floor.** Product depth, functionality,
  design >= 2 (design N/A for non-UI work); code quality >= 1. Below a floor
  is a FAIL whatever the Verdict line says. Round 3 still failing is an
  escalation to the human, not done.
- **It binds a clean commit.** Read `commit:` and `dirty:`. `dirty: true`
  means the tree had uncommitted changes when it was taken — commit, then
  have the verdict re-taken as the next round.

Pure internal refactor / no user-visible surface changed? Skip this step —
but say so explicitly in your final report rather than silently omitting it.

-------------------------------------------------------------------------------
2b. PRODUCT CLAIMS — STILL TRUE?
-------------------------------------------------------------------------------

Skip if the approved plan had no product brief (internal work). Otherwise hold three claims — the success metric actually observed, the non-goals held, the shipped UI matching the approved mockups. Read `references/product-claims.md` before skipping this step.

-------------------------------------------------------------------------------
3. HARNESS INVARIANTS
-------------------------------------------------------------------------------

    brain check

Every row must pass — database integrity, foreign keys, the search index,
cross-entity rules (the one-in-progress policy, verification and task links),
and plan/shot file hashes. Exits 1 on any failure. Fix and re-run; do not
report done over a failing `brain check`.

-------------------------------------------------------------------------------
4. BRAIN COHERENCE
-------------------------------------------------------------------------------

For every path your diff touched, name the brain doc that owns it (a rules
doc, a recipe, a codebase doc, the feature's own doc) and confirm it still
describes reality: find it with `brain search "<term>" --kind doc` or
`brain docs list --section rules`, read it with
`brain docs view <section>/<name> --full`.

- Changed how something behaves or is structured? The owning doc should say so
  now, not what it said before you started. Rewrite it with
  `brain docs set <section> <name> --from <file>` (rules and recipes included).
- Changed a tracked feature's behavior? Its doc should reflect that change:
  `brain docs set features <slug> --from <file>`; confirm with
  `brain features view <slug>`.

Flag, explicitly, any changed path whose owning doc you did NOT update — do
not let it pass silently as "probably fine."

-------------------------------------------------------------------------------
5. CLOSE STATE
-------------------------------------------------------------------------------

Everything written in this step follows the `brain-write` skill — it owns the
slots and the register for each artifact below.

- Final step of record: `brain runs append <slug> --step "..." --observed
  "..." [--run <name>]` — the last verbatim entry in this task's run note.
- Checkpoint: `brain progress add --summary "<what shipped>" --next "<what's
  next, if anything>" --feature <slug> [--run <name>]` — closes the rolling
  cursor for this session (summary <= 200 chars).
- Feature actually done, not just this task? `brain features ship <slug>
  --evidence "<from real output — a verify result, a verdict line>"` — refused
  (exit 1) unless the latest verification is PASS and no tasks are open, and it
  writes its own checkpoint. Never compose `--evidence` from a sentence you
  made up to satisfy the flag.
- PR opened? Record it: `brain features set <slug> --pr <url>`.

-------------------------------------------------------------------------------
6. DEFINITION OF DONE — restated
-------------------------------------------------------------------------------

A task is done only when ALL of the following are true, not "mostly true":

- [ ] Implementation complete, matching the task as framed at kickoff (the
      `brain-start` skill)
- [ ] `brain verify run` green — every declared check, not just the ones you
      remembered to run
- [ ] Independent verification PASS (user-visible work) — a fresh-context
      verifier, or declared `self-verified — <reason>`; every acceptance row
      PASS; quality floors met; a clean commit (`dirty:` not true) — or
      explicitly marked N/A with a reason
- [ ] User-facing work only: the plan's success metric observed (or its
      measurement date named), non-goals held, and shipped UI reconciled
      against the approved mockups — or explicitly marked N/A
- [ ] AI work only (prompt, model, chain, retrieval, agent): the project's
      own eval suite re-run after the last edit, no frozen case failing,
      every fixed bug a new frozen case, human eval feedback answered (the
      `brain-ai` skill) — or explicitly marked N/A
- [ ] `brain check` — all harness invariants pass
- [ ] Feature doc updated, and every changed path's owning rules/recipes/
      codebase doc updated or explicitly flagged as not
- [ ] Feature shipped (`brain features ship`) if the feature itself is done,
      and the PR recorded
- [ ] Run note closed, progress checkpoint written

If anything above is unmet, do not declare the task done — say exactly what's
blocking instead. A partial "done" reported as complete is worse than an
honest "blocked on X."

## Next

- Terminal — nothing follows. The task is closed once state is recorded.
- While recording checkpoints, evidence, and the PR, use the `brain-write` skill.
