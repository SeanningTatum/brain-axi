---
name: brain-verify
description: "verifying a user-visible feature works — independent, skeptical walk of every acceptance criterion (browser, or the named command where no browser reaches): golden + error paths + edge probes, quality floors, screenshot or transcript evidence"
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
- CLI-ONLY FEATURES. When nothing the feature changed is reachable from a
  browser (a CLI command, a library API, a script, a background job), there
  is no app to start and no browser to drive. All three layers below still
  apply, walked by running the real commands yourself: the golden path is
  the primary invocation end to end, the error path is a bad-input /
  refused / non-zero-exit case, edge probes are the empty / repeated /
  out-of-order invocations. Evidence per step is the exact command, its exit
  code, and the observed stdout/stderr (quoted, or a saved transcript linked
  in place of a screenshot). The header's Base URL reads
  `n/a — CLI-only`. This is not a lower bar: an unrun command is an
  unwalked criterion, exactly like an unvisited page.
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
2. NAMING CONVENTION — screenshots
-------------------------------------------------------------------------------

- Golden path steps: NN-<step>, zero-padded two digits, in order:
  01-signin.png, 02-dashboard.png, 03-....png
- Error path steps: E<N>-<step>, one per error scenario walked:
  E1-bad-login.png, E2-....png
- Acceptance-criterion evidence: A<N>-<step>, N = the criterion's row number
  in the Acceptance criteria table: A3-reorder-frames.png. Reuse a golden-
  path shot instead when it already shows the criterion — cite it in the row.
- Edge probes: X<N>-<step>: X1-empty-state.png.
- Fix round N >= 2: every name above gains an rN- prefix (r2-01-signin,
  r2-E1-bad-login, r2-A3-reorder-frames) — see section 6.
- The step name is the SAME string you pass to --step below (the CLI derives
  the filename from it, extension included automatically) — keep it short
  and descriptive; it is what appears in the verdict doc's table too.

-------------------------------------------------------------------------------
3. RECOMMENDED SCRIPT PATTERN (Playwright, condensed)
-------------------------------------------------------------------------------

brain-axi deliberately ships ZERO browser automation — the driver is a
throwaway Playwright script YOU scaffold, run, and delete. Scaffolding:

- Prefer the project's own pinned Playwright (node_modules/.bin/playwright)
  when the repo has one — a globally cached copy can want a different browser
  revision. No project install? Use npx: "npx -y playwright install chromium"
  once, then run your script with node.
- Write the script to a PROJECT-INTERNAL temp path (e.g. tmp/verify-<slug>.mjs
  at the repo root, gitignored) — never /tmp: Node resolves bare imports
  upward from the script's directory, and /tmp has no node_modules. Never name
  it *.spec.* and never put it in the e2e/tests dir, so the CI suite can't
  pick it up.
- Screenshot each asserted step to the temp dir, then persist each one with
  "brain shots add <png> --feature <slug> --step NN-name" (or write directly
  to .brain/features/<slug>/screenshots/NN-name.png — equivalent). Capture on
  PASS as well as FAIL — passing evidence is the point.
- Delete the script when done. The screenshots and the verdict doc are the
  durable evidence; the driver is disposable.

Write a throwaway script (not a committed test file — this is not the CI
regression suite) that:

    // launch clean and extension-free: a real dry run of this playbook once
    // surfaced a phantom hydration warning that turned out to be a password-
    // manager browser extension injecting DOM, not an app bug. Bundled
    // chromium + --disable-extensions + a fresh profile avoids that class of
    // false positive.
    const browser = await chromium.launch({ args: ["--disable-extensions"] });
    const context = await browser.newContext(); // fresh profile, no channel:"chrome"
    const page = await context.newPage();

    const jsErrors = [];
    const networkErrors = [];
    page.on("pageerror", (e) => jsErrors.push(String(e)));
    page.on("console", (msg) => { if (msg.type() === "error") jsErrors.push(msg.text()); });
    page.on("response", (res) => {
      if (res.status() >= 400) networkErrors.push(`${res.status()}@${currentStepLabel}`);
    });

    // golden path: drive it, assert the expected state, screenshot each step
    await page.goto(baseUrl + "/sign-up");
    await page.screenshot({ path: "01-signup.png" });
    // ... fill fields, submit, assert redirect/visible state ...
    await page.screenshot({ path: "02-dashboard.png" });

    // error path: FRESH CONTEXT if the golden path left the session
    // authenticated and the error path needs to be unauthenticated (or vice
    // versa) — many apps redirect an authenticated session away from
    // login/signup routes in a loader/guard, so reusing the same context can
    // make the error-path step silently unreachable instead of failing loud.
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    // ... drive the failure, assert the inline error / rejection surfaces ...
    await freshPage.screenshot({ path: "E1-bad-login.png" });

    await browser.close();

Two gotchas worth restating because they bite often:
- **Fresh browser context for the error path** whenever the golden path
  authenticates and the error path needs an unauthenticated (or differently-
  authenticated) view — don't assume the same page/context can just navigate
  there.
- **Clean, extension-free browser** — launch bundled chromium with
  --disable-extensions and a throwaway profile, never a channel:"chrome"
  pointed at a real user profile. Extensions injecting DOM (password
  managers, ad blockers) produce console noise that looks exactly like an
  app bug.

-------------------------------------------------------------------------------
4. CONSOLE POLICY — jsErrors vs networkErrors
-------------------------------------------------------------------------------

Split every console/page finding into exactly two buckets:

- **jsErrors** — uncaught exceptions, React/hydration warnings, anything
  logged at console.error from app code. Rule: ANY entry here is a FAIL,
  full stop, unless you can trace it to something OUTSIDE the app (see the
  "environment artifact" carve-out below).
- **networkErrors** — non-2xx responses, formatted "<status>@<step>". Rule:
  expected on error-path steps (a 401 from a rejected login is the CORRECT
  behavior, not a defect) — only counts against the verdict if it fired on a
  GOLDEN-PATH step, where it means something broke that shouldn't have.

Environment-artifact carve-out: if a jsError looks app-related but you can
grep the app's own source and confirm the offending token/style/attribute
appears NOWHERE in it, it's very likely a browser extension or the test
harness itself, not a real defect — investigate, state your evidence (what
you grepped, what you found or didn't), and note it as "environment artifact,
not a FAIL" in the Console section rather than silently excluding it. Do not
use this carve-out as an excuse to wave away something you didn't actually
check.

-------------------------------------------------------------------------------
5. WRITE THE VERDICT DOC
-------------------------------------------------------------------------------

Structure (mirror this shape exactly — a reviewer skimming the doc should get
slug, date, verdict, the acceptance table, and the step tables without
reading prose):

    # Verification: <Feature Name>

    - **Slug**: `<slug>` (feature memo: `.brain/features/<slug>/<slug>.md`)
    - **Date**: YYYY-MM-DD
    - **Verified by**: <you / your agent name> (<driver>, e.g. "Playwright CLI — headless script")
    - **Independence**: independent — <who, e.g. "fresh sub-agent, did not implement"> | self-verified — <why no second agent was possible>
    - **Round**: N _(1 for the first walk, file `<date>.md`; a re-walk after a FAIL is round 2, 3, ... in its own `<date>-rN.md`)_
    - **Base URL**: <url> _(dev server: started by agent | already running)_ — or `n/a — CLI-only`
    - **Role**: <the account/role state each path used>
    - **Verdict**: ✅ PASS | ❌ FAIL | ⛔ BLOCKED — _one line why_

    ## Acceptance criteria

    _One row per criterion from the approved plan of record AND every task's
    acceptance. Source in parentheses. Any ❌ row = FAIL verdict._

    | # | Criterion (source) | How checked | Observed | Evidence | Result |
    |---|--------------------|-------------|----------|----------|--------|
    | 1 | User can reorder frames (task t3) | Dragged frame 3 to slot 1, reloaded | Order reverted on reload | [`A1-reorder.png`](../screenshots/A1-reorder.png) | ❌ |
    | 2 | `export --json` exits 0 (task t4 verify) | Ran the named command | exit 0, 3 records | `app export --json; echo $?` → `0` | ✅ |

    ## Golden path

    _What a user does for the happy case._

    | # | Step | Expected | Observed | Screenshot | Result |
    |---|------|----------|----------|------------|--------|
    | 01 | Sign in | Lands on /dashboard | ... | [`01-signin.png`](../screenshots/01-signin.png) | ✅ |

    ## Error path

    _At least one failure the feature must handle gracefully — one row per
    scenario walked (E1, E2, ...)._

    | # | Step | Expected failure surface | Observed | Screenshot | Result |
    |---|------|--------------------------|----------|------------|--------|
    | E1 | Submit invalid input | Inline error, no crash | ... | [`E1-error.png`](../screenshots/E1-error.png) | ✅ |

    ## Edge probes

    _Empty state, boundary values, the second item, reload, the same action
    twice, a different order. Any ❌ row = FAIL verdict._

    | # | Probe | Expected | Observed | Evidence | Result |
    |---|-------|----------|----------|----------|--------|
    | X1 | Reload after save | Saved state persists | ... | [`X1-reload.png`](../screenshots/X1-reload.png) | ✅ |

    ## Console

    - **jsErrors** — quote verbatim, or "none". Any entry = FAIL (unless a
      documented environment artifact — show your grep evidence).
    - **networkErrors** — "<status>@<step>", quote, or "none". Expected on
      error-path steps; a FAIL only if it fired on a golden-path step.

    ## Mockup reconciliation

    _Only when the approved plan carried wireframes. Omit the whole section
    otherwise — and say in the rationale that the plan had none._

    | Screen | Approved mockup | Shipped | Difference | Deliberate? |
    |--------|-----------------|---------|------------|-------------|
    | Settings · empty | `plans/<slug>/v2.html` #screens | [`03-empty.png`](../screenshots/03-empty.png) | CTA moved above the fold | yes — round 2 annotation |

    ## Quality scores

    _Write the rationale FIRST, then the number. 0-3 scale. Any score below
    its floor = FAIL verdict._

    | Criterion | Score (0-3) | Floor | Rationale |
    |-----------|-------------|-------|-----------|
    | product-depth | 1 | 2 | Record button toggles its icon but no audio is captured — display-only where the spec implies interaction |
    | functionality | ... | 2 | ... |
    | design | ... | 2 or N/A | ... |
    | code-quality | ... | 1 | ... |

    ## Findings for main thread

    Anything the implementing agent should act on that is NOT already a ❌
    row above — missing test hooks/selectors, non-blocking bugs, follow-ups —
    or "none". Each one written to the CALIBRATION standard (section 5c).

    ## Verdict rationale

    One paragraph: why PASS/FAIL/BLOCKED. If FAIL or BLOCKED, state the exact
    blocker, not a vague summary.

--- 5b. RECONCILE AGAINST THE APPROVED MOCKUPS ---

Skip when the plan carried no wireframes. Otherwise, before writing the
verdict:

1. Find the approved snapshot. `brain plans view <plan-slug>` prints a
   `snapshot:` path per round (`plans/<slug>/vN.html`, or
   `features/<feature>/plans/<slug>/vN.html` for a feature-bound plan). A
   snapshot is written for EVERY round, so the newest is not automatically the
   approved one — read the snapshot for the round that ENDED the review (the
   round header shows `ended by`). The `help:` line of `plans view` names that
   snapshot outright, and tells you when no round has ended yet; if none has,
   nothing is approved and there is nothing to reconcile against — stop and get
   the plan approved first. Do not read the live artifact path either: the agent
   has been editing it, so it reflects the latest draft, not the approved state.
2. Open its `#screens` section and put each wireframe beside the screenshot
   you just captured for the same screen and state.
3. Fill the mockup-reconciliation table above. A difference is not a failure
   — an UNDISCLOSED difference is. Every row that differs names the change
   and says whether it was deliberate (a later review round, a constraint
   found during implementation) or drift nobody decided on.

A screen the plan mocked up and the walk never reached is a hole in the walk,
not a passing row: capture it or say plainly that it is unverified.

--- QUALITY SCORES — criteria and hard floors ---

Score each on 0-3 (0 absent, 1 weak, 2 solid, 3 excellent). Write the
rationale before the number, so the number follows from the evidence rather
than the rationale being written to justify a number you already chose.

- **product-depth** (floor 2) — features are interactive to the depth the
  spec implies, not display-only or stubbed.
- **functionality** (floor 2) — a user completes the primary tasks without
  guessing: no dead ends, no hidden prerequisite, no step that only works in
  the order the implementer happened to test it.
- **design** (floor 2, UI work only — else N/A) — coherent and deliberate,
  not template defaults.
- **code-quality** (floor 1) — no dead stubs or TODO paths presented as
  done, no copy-paste of existing definitions. Read the diff for this one.

A floor is hard: one criterion below it fails the verdict, however strong
the others are. Averaging is how a stubbed feature ships.

**Verdict** line values, exactly:
- ✅ PASS — every acceptance row ✅, the golden path, every error path and
  every edge probe behaved as expected, every quality score at or above its
  floor, no disqualifying jsError.
- ❌ FAIL — any acceptance row ❌ (or unwalked), any golden-path, error-path
  or edge-probe step that didn't behave as expected, any quality score below
  its floor, or any real jsError fired.
- ⛔ BLOCKED — you could not complete the walk at all (app down, environment
  broken) — this is not the same as FAIL; say what blocked you.

On FAIL the implementer fixes, and a FRESH verifier re-walks — never the one
who wrote the fix. Every round is its own doc with exactly ONE Verdict
line: round 1 is `<YYYY-MM-DD>.md`, round N >= 2 is `<YYYY-MM-DD>-rN.md`
(e.g. `2026-09-29-r2.md`), with `- **Round**: N` in the header. Never
append a second verdict to an earlier round's doc — a doc holding FAIL and
PASS reads as an unreadable verdict. The re-walk covers every acceptance row,
not just the ones that failed last round: fixes break neighbors. Cap: 3
rounds — still failing after round 3 escalates to the human
(`brain playbook execute` step 4b, which also records refine vs pivot).

-------------------------------------------------------------------------------
5c. CALIBRATION — what a good finding looks like
-------------------------------------------------------------------------------

A good finding names the criterion, the observed behavior, and — when you
found it — the file:line or route responsible. Someone should be able to act
on it without re-investigating. Illustrative examples (from other projects,
not this one):

GOOD:
- "Rectangle fill tool allows click-drag to fill a rectangular area" → ❌
  FAIL — tool only places tiles at the drag start/end points; `fillRectangle`
  exists but isn't triggered on mouseUp.
- "User can select and delete placed entity spawn points" → ❌ FAIL — the
  Delete handler at `LevelEditor.tsx:892` requires both `selection` and
  `selectedEntityId`; clicking an entity only sets `selectedEntityId`.
- "User can reorder animation frames via API" → ❌ FAIL —
  `PUT /frames/reorder` is defined after `/{frame_id}`; FastAPI parses
  'reorder' as an int → 422.

BAD:
- "Mostly works, a few rough edges." — names no criterion, no behavior, no
  location. It is an approval wearing a finding's clothes; the implementer
  cannot act on it and the verdict it excuses is unexamined.
- "Delete seems flaky." — which delete, doing what, how often, observed
  where? "Seems" means you stopped investigating. Reproduce it (what exact
  sequence fails, what it did instead) or say plainly you could not.

Note what the good examples share: each is a FAIL row, not a softened
"finding". A feature that is present but doesn't do what the criterion says
is a failing criterion.

-------------------------------------------------------------------------------
6. PERSIST THE EVIDENCE (brain-axi commands)
-------------------------------------------------------------------------------

Copy each screenshot in with the naming convention baked into --step:

    npx -y brain-axi shots add ./01-signup.png --feature authentication --step 01-signup
    npx -y brain-axi shots add ./02-dashboard.png --feature authentication --step 02-dashboard
    npx -y brain-axi shots add ./E1-bad-login.png --feature authentication --step E1-bad-login

This lands each file at
.brain/features/<slug>/screenshots/<step>.<ext> — write the verdict doc's
table links as relative paths from the verifications/ dir: ../screenshots/<step>.<ext>.

Round N >= 2: prefix every --step with rN- (`--step r2-01-signup`,
`--step r2-E1-bad-login`). `shots add` overwrites an existing step's file,
so reusing round 1's step names would silently replace the images round 1's
doc cites — the FAIL evidence the re-walk exists to answer. Link round N's
doc to its own rN- files only.

Then write the verdict doc itself to
.brain/features/<slug>/verifications/<YYYY-MM-DD>.md (today's date; round
N >= 2 is <YYYY-MM-DD>-rN.md — one Verdict per doc, never an addendum). There is
no CLI write command for the doc body — write the file directly with your
file-editing tool, following the structure above.

Confirm it's discoverable:

    npx -y brain-axi verifications <slug>
    npx -y brain-axi verifications view <slug> <YYYY-MM-DD>   (or <YYYY-MM-DD>-rN)

Both should show your new doc with the correct verdict parsed from the
**Verdict** line. Then bind it to the code with a receipt naming BOTH sides:

    npx -y brain-axi receipt <slug> --verified-by <you> --implemented-by <who wrote it>

(`--implemented-by` defaults to HEAD's git author, `--verified-by` to
`git config user.name`, then `$USER` — so a solo human stamping with defaults is caught
as self-verified. A sub-agent verifier shares your git identity: always pass
its own name via `--verified-by`. The receipt records each name's source
— `verified_by_source` / `implemented_by_source`: `flag` or `default` —
and a defaulted `verified_by` never counts as independent: `brain check
--strict` warns "identities not declared" even when the names differ, and
the receipt's `warning:` says "identities defaulted" unless both flags are
passed.) If the two are the same identity the receipt still stamps but
prints a `warning:`, and `brain check --strict` reports a `warn` row;
that must be matched by your `- **Independence**: self-verified — <reason>`
line. If a checkpoint is warranted, follow up with
`brain progress add --summary "..."` noting the verification result.

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
