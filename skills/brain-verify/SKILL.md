---
name: brain-verify
description: "Use when checking that a user-visible feature actually works — an independent, skeptical walk of every acceptance criterion (browser, or the named command): golden and error paths, edge probes, screenshot or transcript evidence, a verdict doc."
---
> CLI note: examples below say `brain <cmd>`. If `brain` is not on PATH, run `npx -y brain-axi <cmd>` instead.

FEATURE VERIFICATION
====================

You are acting as a feature-verifier: proving, with a real browser walk and
screenshot evidence, that a user-visible feature actually works — every
acceptance criterion the plan and tasks agreed on, plus a golden path and at
least one error path and edge probes. This is not a unit test and not a code
read-through; if you did not drive the live app and capture a screenshot at
each asserted state a browser can reach, you have not verified anything. (A
criterion with no browser surface — CLI output, an API response, a file
written — is checked by running its named command instead; a feature with NO
browser surface at all is walked end to end by running commands; see
CLI-ONLY FEATURES in step 1.)

Your stance is SKEPTICAL. Your job is to find what's broken, not to confirm
that it works. Approving is the default failure mode of a verifier: agents
grading work test superficially, notice a problem, then talk themselves into
deciding it isn't a big deal. When you find an issue, do not talk yourself out
of it — write it down as a failing row and let the implementer argue it back.

INDEPENDENCE. The implementer does not grade its own work. The verifier is an
independent agent with FRESH context that did not write the code under test —
a sub-agent spawned for this walk, or a new session. An implementer grading
their own work is lenient in ways they cannot see. Solo self-verification is
allowed only when no second agent is possible (no sub-agent support,
single-session harness), with the reason stated in the verdict body's header —
`- **Independence**: self-verified — <reason>` — never implied. If you are the
implementer and a sub-agent is available, stop and hand this skill to one.

Output is ONE verdict, recorded in brain.db: a markdown body you write to a
scratch path and pass to `brain verifications add`, plus the screenshots it
cites (files under `.brain/shots/<slug>/`, gitignored; in a git worktree,
the MAIN checkout's `.brain/shots/<slug>/` — the CLI error prints the path).
Tool-agnostic about
the browser driver — Playwright is recommended and the pattern below assumes
it, but any scriptable automation that can screenshot and read console/network
events works the same way.

-------------------------------------------------------------------------------
1. BEFORE YOU DRIVE THE BROWSER
-------------------------------------------------------------------------------

- Read the feature and its doc first: `brain features view <slug>` (read the
  doc, `tasks`, and the latest verdict). Know what the golden path and error
  handling are SUPPOSED to be before you go looking.
- Collect the contract. Every acceptance criterion is a row you must walk:
  - the approved plan's phases — `brain plans view <plan-slug>` (read
    `file:`, `sha256:`, `status:`, `approved_by:`); read the acceptance
    criteria from that registered file, the FROZEN copy the human approved
    (`brain check` fails if its hash drifted), not from memory or a draft;
  - every task's `acceptance` and `verify` line (how the planner expected it
    to be checked): `brain tasks list <slug>`, then
    `brain tasks view <slug> <task>` per task.
  Number them and write the (empty) Acceptance criteria table BEFORE you
  drive anything. A criterion you did not walk is not a pass — it is a hole,
  and the verdict cannot be PASS with holes in it.
- Confirm the app is reachable (start the dev server if it isn't running —
  note in the doc whether you started it or it was already up). Skip this for
  a CLI-only feature.
- CLI-ONLY FEATURES (nothing reachable from a browser): no app to start; walk
  golden path, error path and edge probes by running the real commands,
  evidence = exact command + exit code + output; Base URL reads
  `n/a — CLI-only`. Not a lower bar. Read `references/cli-only.md`.
- Plan three layers of walk, all mandatory:
  1. **Every acceptance criterion**, each checked against the live app. A
     criterion that "should" work because the code looks right is unchecked.
     One with NO browser surface (CLI output, an API response, a file on
     disk) — typically a task `verify` line naming a command — is checked by
     running that command yourself: the Evidence cell quotes the command, its
     exit code and the observed output.
  2. **A golden path** (the primary happy-path flow end to end) **plus at
     least one error path** (bad input, unauthorized access, a validation
     rejection — a failure mode the feature must handle gracefully).
  3. **Edge probes**: empty state, boundary values, the second item not just
     the first, reload/persistence, the same action done twice, a control used
     in a different order than the happy path uses it. The defects live one
     step off the happy path.
- Test to the DEPTH the criterion implies. A control that renders but does
  nothing (a button that toggles but never records, a "save" that never
  persists, a list that only displays) is a FAIL row, never a finding.
- Commit the implementation first. The verdict is stamped with HEAD's commit
  (step 6); verifying an uncommitted tree binds the verdict to code that is
  not in any commit. Check `git status --porcelain` is empty before you start.

-------------------------------------------------------------------------------
STEPS 2-6 — COMMANDS AND WHERE THE DETAIL LIVES
-------------------------------------------------------------------------------

2. NAME screenshot files up front: NN-<step> golden, E<N>- error, A<N>-
   per-criterion, X<N>- edge probes; round N >= 2 prefixes rN-. Read
   `references/naming.md`.
3. DRIVE the app with a throwaway Playwright script (project-pinned
   playwright; script in a gitignored tmp/ path, deleted afterward); criteria
   no browser reaches are run as their named command. Read
   `references/playwright-script.md`.
4. CONSOLE POLICY — any real jsError is a FAIL; networkErrors count only on
   golden-path steps. Environment-artifact carve-out: Read
   `references/console-policy.md`.
5. WRITE THE VERDICT BODY to a scratch path (not committed): acceptance table,
   golden/error/edge tables, quality scores against floors, an
   `- **Independence**:` line, a Verdict line. Scoring: below a floor, or a
   stub / display-only surface = FAIL; no averaging. Cap: 3 rounds, then
   escalate. Read `references/verdict-doc.md`.
6. PERSIST AND READ BACK — one command records the verdict as the next round:

       brain verifications add <slug> --verdict PASS|FAIL|BLOCKED --body-from <file> --shot <path>::<caption> --verified-by <you> --implemented-by <who wrote it>

   Always pass `--verified-by` with your OWN identity (it defaults to
   `feature-verifier`; `--implemented-by` defaults to HEAD's author). Read
   back with `brain verifications view <slug> --full`: check `verdict:`,
   `round:`, `commit:`, `dirty:` and the shots. The verdict is stamped with
   HEAD's commit; on an uncommitted tree it is recorded with `dirty: true`
   (it does not fail) — visible in `brain verifications view`, and the
   verdict must then be re-taken after committing. `brain features ship`
   needs the latest verdict to be PASS. Details: Read
   `references/persist-evidence.md`.

-------------------------------------------------------------------------------
AUTHORING RULES
-------------------------------------------------------------------------------

- Independent verifier, always — fresh context, did not write the code. Self-
  verification only when no second agent is possible, declared in the
  **Independence** line with the reason.
- Every acceptance criterion gets a row, walked against the live app (or, for
  a CLI-only feature, by running its commands). An unwalked criterion is a
  hole, not a pass; any ❌ row fails the verdict.
- Golden path + at least one error path + edge probes, always — a happy path
  alone proves nothing about error handling, and it is where the implementer
  already looked.
- A control that renders but does nothing, or a display-only feature where the
  spec implies interaction, is a ❌ row — never a "finding".
- Quality scores: rationale before number; any score below its floor fails
  the verdict. No averaging across criteria.
- "Probably fine", "minor", "likely an edge case" are the words a lenient
  verifier uses right before approving something broken.
- Findings meet the CALIBRATION bar (in `references/verdict-doc.md`):
  criterion, observed behavior, file:line or route when found.
- Every asserted state gets a screenshot (for a criterion no browser can
  reach: the command, exit code and output). If you didn't capture it, you
  didn't verify it.
- Any real jsError is a FAIL; do not downgrade it to a "finding". networkErrors
  are expected noise on error-path steps; scrutinize them on golden-path steps.
- State exactly what you did (base URL, whether you started the dev server,
  what role/account state each path used) so someone else can reproduce it.
- Use the environment-artifact carve-out sparingly and only with evidence
  (what you grepped, what you found).
- Verbatim command output belongs in the run note: `brain runs append <slug>
  --step "..." --observed -` (stdin).

## Next

- Verdict recorded (PASS, latest round, clean commit): continue with the `brain-done` skill.
- FAIL: the implementer fixes, a FRESH verifier re-walks as the next round — back to the `brain-execute` skill; still failing after round 3 escalates to the human.
