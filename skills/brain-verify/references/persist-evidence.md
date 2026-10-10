[brain-verify reference — step 6: persist the evidence]

-------------------------------------------------------------------------------
6. PERSIST THE EVIDENCE (brain commands)
-------------------------------------------------------------------------------

0. Commit the implementation FIRST. `verifications add` stamps HEAD's commit
   and records `dirty: true` when the tree has uncommitted changes (including
   untracked files). It does not fail, but a dirty verdict binds to code that
   is in no commit: it shows in `brain verifications view`, and you should
   re-take it (the next round) after committing so the receipt is clean.

1. Save each screenshot under `.brain/shots/<slug>/` (naming: `naming.md`).
   In a git worktree, that is the MAIN checkout's `.brain/shots/<slug>/` (pass
   its absolute path); a worktree's own `.brain/shots/` is refused with
   SHOT_OUTSIDE_SHOTS_DIR, and the error prints the right dir.

2. Write the verdict body (structure: `verdict-doc.md`) to a scratch file
   outside the committed tree, e.g. tmp/verdict-<slug>.md.

3. Record it — screenshots ride along with `--shot`, repeatable, each
   `path::caption`:

       brain verifications add authentication --verdict FAIL --body-from tmp/verdict-authentication.md \
         --shot .brain/shots/authentication/01-signup.png::"01-signup: form renders" \
         --shot .brain/shots/authentication/E1-bad-login.png::"E1: bad password rejected" \
         --verified-by verifier-agent-2 --implemented-by claude-main

   The verdict value must match the body's Verdict line (PASS | FAIL |
   BLOCKED). The round number is automatic: the next round for that feature.
   Round 2 and later get their own rN- shot files; never overwrite round 1's.

4. Read it back and check the stamp:

       brain verifications view authentication --full

   Read `verdict:`, `round:`, `commit:`, `dirty:`, `verified_by:`,
   `implemented_by:` and that every shot listed is the file you meant. Use
   `brain verifications list --feature authentication` for the round history.

Identity. `--verified-by` defaults to `feature-verifier` and
`--implemented-by` defaults to HEAD's git author. A sub-agent verifier
shares your git identity, so always pass `--verified-by` with the
verifier's own name — and `--implemented-by` with whoever wrote the code —
so the record shows two different parties. If both are the same identity,
the body's `- **Independence**: self-verified — <reason>` line must say why
no second agent was possible.

Verbatim command output (CLI-only criteria, transcripts) goes to the run
note, not the verdict body alone:

    node bin/app.js export 2>&1 | brain runs append authentication --step "A2: app export" --observed -

`brain features ship <slug>` is refused unless the latest verification is
PASS (and no tasks are open), so a FAIL round is not the end state: the fix
and a fresh verifier's next round are. Ship never refuses over ancestry
(squash merges and rebases rewrite it), but it prints a `warning:` line when
the PASS commit is not an ancestor of HEAD, is unknown, or was recorded
`dirty: true` — the cue to re-take the verdict on the current HEAD.
