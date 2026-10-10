---
name: brain-verify
description: "Use when checking that a user-visible feature actually works — an independent, skeptical walk of every acceptance criterion (browser, or the named command): golden and error paths, edge probes, screenshot or transcript evidence, a verdict doc."
---
FEATURE VERIFICATION PLAYBOOK
==============================

You are acting as a feature-verifier: proving, with a real browser walk and
screenshot evidence, that a user-visible feature actually works — every
acceptance criterion the plan and tasks agreed on, plus a golden path and at
least one error path and edge probes. This is not a unit test and not a code
read-through; if you did not drive the live app and capture a screenshot at
each asserted state a browser can reach, you have not verified anything. (A criterion with no browser surface —
CLI output, an API response, a file written — is checked by running its named
command instead; see step 1. A feature with NO browser surface at all — a
CLI, a library, a background job — is walked end to end by running commands;
see CLI-ONLY FEATURES in step 1.)

Your stance is SKEPTICAL. Your job is to find what's broken, not to confirm
that it works. Approving is the default failure mode of a verifier: agents
grading work test superficially, notice a problem, then talk themselves into
deciding it isn't a big deal. When you find an issue, do not talk yourself out
of it — write it down as a failing row and let the implementer argue it back.

INDEPENDENCE. The verifier must be an agent with FRESH context that did not
write the code under test — a sub-agent spawned for this walk, or a new
session. An implementer grading their own work is lenient in ways they cannot
see. Solo self-verification is allowed only when no second agent is possible
(no sub-agent support, single-session harness), and must be declared in the
doc's header — `- **Independence**: self-verified — <reason>` — never implied.
If you are the implementer and a sub-agent is available, stop and hand this
playbook to one.

Output of this playbook is ONE file: a verdict doc at
.brain/features/<slug>/verifications/<YYYY-MM-DD>.md (a fix round N >= 2
writes <YYYY-MM-DD>-rN.md instead), plus the screenshots it references, persisted via the brain-axi CLI (commands below). Tool-agnostic
about the browser driver — Playwright is the recommended approach and the
pattern below assumes it, but any scriptable browser automation that can
screenshot and read console/network events works the same way.

-------------------------------------------------------------------------------
1. BEFORE YOU DRIVE THE BROWSER
-------------------------------------------------------------------------------

- Read the feature doc first: `brain features view <slug>`. Know what the
  golden path and error handling are SUPPOSED to be before you go looking.
- Collect the contract. Every acceptance criterion is a row you must walk:
  - the approved plan's plan of record (`plan` §10) — `brain plans view
    <plan-slug>` names the approved snapshot; read its phases' acceptance
    criteria from THAT snapshot, not the live draft;
  - every task's `acceptance` (and its `verify` hint, when the task carries
    one — how the planner expected it to be checked): `brain tasks <slug>`,
    then `brain tasks view <slug> <id>` per task.
  Number them and write the (empty) Acceptance criteria table BEFORE you
  drive anything. A criterion you did not walk is not a pass — it is a hole,
  and the verdict cannot be PASS with holes in it.
- Confirm the app is reachable (start the dev server if it isn't already
  running — note in the doc whether you started it or it was already up).
  Skip this for a CLI-only feature (below).
- CLI-ONLY FEATURES (nothing reachable from a browser): no app to start; walk golden path, error path, and edge probes by running the real commands, evidence = exact command + exit code + output; Base URL reads `n/a — CLI-only`. Not a lower bar. Full rules: Read `references/cli-only.md` (`brain playbook verify --ref cli-only`).

- Plan three layers of walk, all mandatory:
  1. **Every acceptance criterion**, each checked against the live app (the
     table above). A criterion that "should" work because the code looks
     right is unchecked. A criterion with NO browser surface (CLI output, an
     API response, a file on disk) — typically one whose task `verify` line
     names a command — is checked by running that command yourself: the
     Evidence cell quotes the exact command, its exit code, and the observed
     output (or links a saved transcript). A browser walk and screenshot are
     required for what a browser can reach, not invented for what it can't.
  2. **A golden path** (the primary happy-path flow end to end) **plus at
     least one error path** (a failure mode the feature must handle
     gracefully — bad input, unauthorized access, a validation rejection).
  3. **Edge probes** for criteria at the edge of the build — empty state,
     boundary values, the second item not just the first, reload/persistence,
     the same action done twice, a control used in a different order than the
     happy path uses it. Out-of-the-box verifiers stop at the happy path; the
     defects live one step off it.
- Test to the DEPTH the criterion implies. A control that renders but does
  nothing when used (a button that toggles but never records, a "save" that
  never persists, a list that only displays) is a FAIL row, never a finding.
- Decide your screenshot naming up front (see NAMING below) so step numbers
  in the script match the step numbers in the doc's tables.

-------------------------------------------------------------------------------
STEPS 2-6 — COMMANDS AND WHERE THE DETAIL LIVES
-------------------------------------------------------------------------------

2. NAME screenshots up front: NN-<step> golden, E<N>- error, A<N>- per-criterion, X<N>- edge probes. Round N >= 2: prefix every --step with rN- (`shots add` overwrites a step's file).  Read `references/naming.md` (`brain playbook verify --ref naming`).
3. DRIVE the app with a throwaway Playwright script (project-pinned playwright; script in a gitignored tmp/ path, deleted afterward); criteria no browser reaches are run as their named command. Script pattern: Read `references/playwright-script.md` (`brain playbook verify --ref playwright-script`).
4. CONSOLE POLICY — any real jsError is a FAIL; networkErrors count only on golden-path steps. Carve-out for environment artifacts: Read `references/console-policy.md` (`brain playbook verify --ref console-policy`).
5. WRITE THE VERDICT DOC at `.brain/features/<slug>/verifications/<YYYY-MM-DD>.md` (round N >= 2: `<YYYY-MM-DD>-rN.md`; one Verdict per doc): acceptance table, golden/error/edge tables, quality scores against floors, an `- **Independence**:` line, a Verdict line. Cap: 3 rounds, then escalate. Structure, quality scores, calibration: Read `references/verdict-doc.md` (`brain playbook verify --ref verdict-doc`).
6. PERSIST: `npx -y brain-axi shots add ./<file>.png --feature <slug> --step <step>`; write the doc with your file tool; confirm with `npx -y brain-axi verifications <slug>`; bind it with `npx -y brain-axi receipt <slug> --verified-by <you> --implemented-by <who wrote it>` (always pass the sub-agent verifier's own name). Receipt identity rules: Read `references/persist-evidence.md` (`brain playbook verify --ref persist-evidence`).

-------------------------------------------------------------------------------
AUTHORING RULES
-------------------------------------------------------------------------------

- Independent verifier, always — fresh context, did not write the code. Self-
  verification only when no second agent is possible, declared in the
  **Independence** header line with the reason.
- Every acceptance criterion gets a row, walked against the live app (or,
  for a CLI-only feature, by running its commands). An unwalked criterion is a hole, not a pass; any ❌ row fails the verdict.
- Golden path + at least one error path + edge probes, always — a
  verification with only a happy path proves nothing about error handling,
  and the happy path is where the implementer already looked.
- A control that renders but does nothing, or a display-only feature where
  the spec implies interaction, is a ❌ row — never a "finding".
- Quality scores: rationale before number; any score below its floor fails
  the verdict. No averaging across criteria.
- When you find an issue, do not talk yourself out of it. "Probably fine",
  "minor", "likely an edge case" are the words a lenient verifier uses right
  before approving something broken.
- Findings meet the CALIBRATION bar (section 5c): criterion, observed
  behavior, file:line or route when found.
- Every asserted state gets a screenshot (for a criterion no browser can
  reach — CLI-only feature or not: the command, exit code and output). If you didn't capture it, you didn't
  verify it.
- Any real jsError is a FAIL. Do not downgrade a genuine app error to a
  "finding" to avoid a FAIL verdict — that defeats the entire point of this
  playbook.
- networkErrors are expected noise on error-path steps; scrutinize them only
  on golden-path steps.
- State exactly what you did (base URL, whether you started the dev server,
  what role/account state each path used) — the doc should let someone else
  reproduce your walk without guessing.
- Use the environment-artifact carve-out sparingly and only with evidence
  (what you grepped, what you found) — never as an unexamined assumption.

## Next

- Verdict written and the receipt stamped: continue with the `brain-done` skill.
