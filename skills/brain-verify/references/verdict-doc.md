[brain-verify reference — sections 5, 5b, quality scores, 5c: the verdict doc]

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

