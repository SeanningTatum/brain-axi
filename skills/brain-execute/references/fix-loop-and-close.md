[brain-execute reference — steps 4b, 5, 6]

4b. **THE FIX LOOP — on FAIL, refine or pivot, then re-grade fresh.** A FAIL
   is the loop working, not a dead end. Per round:
   - Read the failing rows — the verifier's feedback is the spec for the fix
     (`brain verifications view <slug> --round N --full`).
   - Decide, and record the decision BEFORE touching code:
     `brain runs append <slug> --step "round N: refine|pivot — <why>"
     --observed "<failing rows>"`. **Refine** when the rows are trending
     toward pass (fewer failures, narrower each round). **Pivot** to a
     different approach when the same rows fail again or the fix keeps
     widening — polishing a direction that is not converging burns rounds.
   - Fix and commit, then a NEW fresh-context verifier re-runs the whole
     contract and records it with `brain verifications add <slug> --verdict
     PASS|FAIL|BLOCKED --body-from <file>` — the next round number is
     automatic, one verdict per round, never an addendum to the earlier
     round. The verifier is never the round-1 verifier re-reading its own
     notes, and never you. (A verdict recorded on an uncommitted tree is stamped
     `dirty: true` — commit, then re-verify for a clean receipt.)
   - **Cap: 3 rounds.** Still failing after round 3? Stop and escalate to the
     human with the remaining failing rows, what each round tried, and the
     refine/pivot record. A fourth silent round is a decision they did not
     get to make.

5. **Close, then ship.**
   - **Worker: `brain tasks set <slug> <task-id> --status done --evidence
     "..." --by <name>`** once the task's acceptance criteria is
     demonstrably met. `--evidence` is required (mirrors the ship gate) and
     must be real observed output, never a summary written from memory.

     **GATED AUTOSHIP.** Closing the LAST open task on a feature
     automatically attempts `brain features ship`'s identical preflight: no
     open tasks, and the latest verification is PASS. If both hold, it ships
     and writes a checkpoint. Otherwise the ship is refused with exit 1 and
     a hint — but the task close already landed (read `task:` in the
     result); do NOT re-run the task update. Fix the gap the hint names,
     then ship explicitly. Nothing about the feature changes on a refused
     ship. Pass `--no-autoship` to skip the attempt entirely (e.g. the
     coordinator still has other verification work to do before shipping).
   - **Coordinator: `brain features ship <slug> --evidence "..."`** — the
     explicit path, used for a solo feature or whenever autoship declined
     and the gap it named has since been closed. Requires non-empty
     `--evidence`; no-ops cleanly if already shipped (read `outcome:`);
     refuses (exit 1, nothing written) while tasks are open or the latest
     verification is not PASS; on success sets status shipped + evidence
     and writes its own checkpoint. Then run `brain check` and report any
     failure honestly — the ship itself already happened.

6. **Record the PR: `brain features set <slug> --pr <url>`** — coordinator,
   after `gh pr create` (or however the PR gets opened), records its URL.
   This flips the dashboard to its PR-opened terminal state — the loop's
   visible endpoint: approval → execution → PR. Re-running overwrites (fine
   for a force-pushed replacement PR).
