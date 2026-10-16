[brain-execute reference — steps 4b, 5, 6]

4b. **THE FIX LOOP — on FAIL, refine or pivot, then re-grade fresh.** A FAIL
   is the loop working, not a dead end. Per round:
   - Read the failing rows — the verifier's feedback is the spec for the fix.
   - Decide, and record the decision BEFORE touching code:
     `brain runs append <slug> --step "round N: refine|pivot — <why>"
     --observed "<failing rows>"`. **Refine** when the rows are trending
     toward pass (fewer failures, narrower each round). **Pivot** to a
     different approach when the same rows fail again or the fix keeps
     widening — polishing a direction that is not converging burns rounds.
   - Fix, then a NEW fresh-context verifier re-runs the whole contract in a
     new doc, `verifications/<YYYY-MM-DD>-rN.md` with `- **Round**: N`
     (one Verdict per doc; never an addendum to the earlier round) — never
     the round-1 verifier re-reading its own notes, and never you.
   - **Cap: 3 rounds.** Still failing after round 3? Stop and escalate to the
     human with the remaining failing rows, what each round tried, and the
     refine/pivot record. A fourth silent round is a decision they did not
     get to make.

5. **Close, then ship.**
   - **Worker: `brain tasks done <slug> <task-id> --evidence "..."`** once
     the task's acceptance criteria is demonstrably met. `--evidence` is
     required (mirrors `brain ship`'s gate) and must be real observed
     output, never a summary written from memory.

     **GATED AUTOSHIP.** Closing the LAST open/claimed task on a feature
     automatically attempts `brain ship`'s IDENTICAL strict preflight. On a
     feature with a PASS verification bound to an ancestor-of-HEAD commit, it
     ships. Otherwise it refuses — reported together with the task close, in
     one result, still exit 0: the task closing is the operation this command
     primarily performs and it already succeeded; the ship declining is the
     gate working as designed, not a failure of this command. Nothing is
     written by a refused ship — `feature_list.json` stays byte-identical.
     Pass `--no-autoship` to skip the attempt entirely (e.g. the coordinator
     still has other verification work to do before shipping).
   - **Coordinator: `brain ship <slug> --evidence "..."`** — the explicit
     path, used for a solo feature or whenever autoship declined and the gap
     it named has since been closed. Requires non-empty `--evidence`
     (refuses otherwise); no-ops cleanly if already shipped; sets status
     shipped + evidence; warns (does not block) if the feature has zero
     screenshots; records a `brain progress add` checkpoint; then runs
     `brain check` and reports any invariant failure honestly — the status
     change is NOT rolled back on a check failure, because the ship itself
     already happened.

6. **Record the PR: `brain pr <slug> --url <url>`** — coordinator, after
   `gh pr create` (or however the PR gets opened), records its URL. This
   flips the dashboard to its PR-opened terminal state and checkpoints it —
   the loop's visible endpoint: approval → execution → PR. Re-running
   overwrites (fine for a force-pushed replacement PR).

