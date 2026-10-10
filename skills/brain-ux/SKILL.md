---
name: brain-ux
description: "Use while planning work that adds or changes a screen or UI — greyscale wireframes per screen, the empty/loading/error/success state matrix, and the user-journey flow, so the interface is approvable before it is built."
---
UX ARTIFACT PLAYBOOK
=====================

You are about to add a wireframe + UX-flow section to a plan artifact — the
same self-contained HTML file the `brain-plan` skill (`brain playbook plan` if skills are unavailable) already teaches you to
write, reviewed inside `brain review`. This playbook is additive to that one:
read it, then fold its output into the plan document at the points `plan`
already names: its §0 style block gets the wireframe kit, and its §6 (UI
mockups + UX flows) is the section this playbook fills. The job here is narrower than the whole plan: a
reviewer should be able to say "that layout is wrong" and "you forgot the
empty state" while the screen is still free — a wireframe, not code.

-------------------------------------------------------------------------------
0. WHEN THIS APPLIES
-------------------------------------------------------------------------------

Apply this playbook when the plan adds or changes any of:

- a screen or page the user navigates to;
- a rendered view, panel, modal, or drawer that appears/disappears based on
  state;
- any other visual surface a human looks at and judges by its layout.

Do NOT apply it to a CLI-only or purely internal change with no rendered
surface. Note one deliberate carve-out: a CLI's own *output shape* (a new
table, a changed flag, a different TOON payload) IS a product surface a human
should be able to approve — but it belongs in the `brain-product` skill (`brain playbook product` if skills are unavailable), not
here. This playbook is specifically about pixels a human looks at, not text a
human reads in a terminal.

If you are unsure: would a screenshot of the finished feature look different
from a screenshot of the feature today? If yes, you are in this playbook.

-------------------------------------------------------------------------------
ORDERED STEPS
-------------------------------------------------------------------------------

1. Put the wireframe CSS kit in the plan's style block. The kit: Read `references/wireframe-kit.md` (`brain playbook ux --ref wireframe-kit`).
2. Inventory every screen the plan adds or changes, one greyscale wireframe each. Procedure and examples: Read `references/screen-inventory.md` (`brain playbook ux --ref screen-inventory`).
3. Fill the screen-state matrix (section 3 below).
4. Draw the user-journey flow — what the PERSON does. Mermaid conventions: Read `references/user-journey.md` (`brain playbook ux --ref user-journey`).
5. Layout variants that are a genuine coin flip become side-by-side decision cards. Markup: Read `references/variant-cards.md` (`brain playbook ux --ref variant-cards`).
6. Know how a reviewer annotates a mockup before you write one. The annotation model: Read `references/annotation.md` (`brain playbook ux --ref annotation`).

-------------------------------------------------------------------------------
3. SCREEN-STATE MATRIX
-------------------------------------------------------------------------------
What it's for: a table, screen down the rows and state across the columns
(empty / loading / error / success, plus any state specific to the surface),
so a blank or unconsidered cell is visible at a glance. Empty and error states
are exactly what plans forget — nobody omits the success screenshot, but "what
does it look like with zero channels" gets skipped constantly. The matrix
makes that gap a visible hole instead of a silent one.

    <table>
      <thead><tr><th>Screen</th><th>Empty</th><th>Loading</th><th>Error</th><th>Success</th></tr></thead>
      <tbody>
        <tr><td>Notification settings</td>
          <td>wireframed above</td>
          <td>skeleton rows, same layout</td>
          <td>inline banner: "Couldn't load channels — retry"</td>
          <td>wireframed above (2 channels)</td></tr>
        <tr><td>Add channel modal</td>
          <td>n/a — a form has no empty state</td>
          <td>Save button shows a spinner, fields disabled</td>
          <td>inline error under the destination field</td>
          <td>wireframed above</td></tr>
      </tbody>
    </table>

Two cells above are legitimately "n/a" — a form has no empty state, full
stop. That's fine. What is NOT fine is an entire ROW reading n/a: that means
the states were asserted away, not designed. See the anti-pattern in
section 8.

-------------------------------------------------------------------------------
7. WRITING MOCKUPS THAT SURVIVE REVIEW
-------------------------------------------------------------------------------

- Label every wireframe with its screen name AND its state — a caption
  reading just "Settings" with no state is not enough to know what you're
  looking at.
- One wireframe, one idea. If you need three sentences of caption to explain
  what a single mockup shows, it is probably two screens or two states
  crammed into one box.
- Never let a mockup contradict the plan of record (`plan` §10) — if the plan
  says phase 2 removes the "Manage" button, the phase-2 wireframe must not
  still show it.
- When a round of feedback changes a screen, add a NEW wireframe for the
  revised version rather than silently editing the old one in place — a
  reviewer approving round 2 should be able to see what changed since round 1,
  the same way `plan` tracks round number in its header strip.
- Keep everything offline-renderable: no images pulled from the network, no
  webfonts, no external stylesheet. The wireframe kit is pure CSS for exactly
  this reason — it never needs an asset to render.

-------------------------------------------------------------------------------
8. ANTI-PATTERNS
-------------------------------------------------------------------------------

- **Happy-path-only screens** — every mockup shows success with data already
  in it. → Fill in the state matrix (section 3) first, then wireframe
  whatever cells aren't legitimately n/a.
- **Decorative mockups** that show nothing the reviewer can decide on. → Every
  wireframe must map to a real decision; if nothing about it is debatable,
  cut it.
- **Wireframes that drift from the plan of record** — a mockup shows a button
  phase 3 explicitly removes. → Re-check every screen against `plan` §10
  before shipping; a reviewer trusts the pictures over the prose.
- **Hi-fi styling smuggled in** — real brand colors, a logo, custom type in
  "just a quick mockup." → Strip back to the `.wf-*` greyscale; color turns
  a layout decision into a color argument (section 1).
- **Controls missing `data-brain-action`** — a custom `.wf-btn` with its own
  `onclick` gets swallowed by annotate mode instead of firing. → Any custom
  element with real click behavior needs it, no exceptions (section 6).
- **A flow diagram that's really a sitemap** — boxes and arrows with no
  triggers on the edges, showing what screens exist, not how a person moves
  between them. → Every edge needs a label naming the click that causes it.
- **A state matrix with every cell "n/a"** — states dodged, not designed. →
  A whole row of n/a means go design those states, not rule them all out.

-------------------------------------------------------------------------------
9. READINESS
-------------------------------------------------------------------------------

Before the plan goes to review:

- [ ] Every screen the plan adds or changes has at least one wireframe
- [ ] Each wireframe's caption names both the screen and the state
- [ ] The screen-state matrix has no row where every cell is n/a
- [ ] The user-journey flow diagram has a trigger on every edge, including at
      least one failure or abandonment branch
- [ ] Every `.wf-*` mockup uses greyscale only — no color, no imagery
- [ ] Any variant worth debating is a decision card with two wireframes, not
      a paragraph of prose
- [ ] Every custom clickable control carries `data-brain-action`
- [ ] Any attached reference image is a real `<img>`, sized >= 80px, meant for
      pin-drop — not a substitute for a wireframe you didn't want to build

Anything unchecked means the plan is not ready for `brain review` yet — go
back and fix that one thing, don't ship it half-mocked.

## Next

- Back to the `brain-plan` skill — the mockups and flows fill the plan's UI section; continue with the remaining sections.
