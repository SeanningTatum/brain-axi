---
name: brain-ux
description: "any plan that adds or changes a screen — wireframes, screen states, user flows"
---
UX ARTIFACT PLAYBOOK
=====================

You are about to add a wireframe + UX-flow section to a plan artifact — the
same self-contained HTML file `brain playbook plan` already teaches you to
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
should be able to approve — but it belongs in `brain playbook product`, not
here. This playbook is specifically about pixels a human looks at, not text a
human reads in a terminal.

If you are unsure: would a screenshot of the finished feature look different
from a screenshot of the feature today? If yes, you are in this playbook.

-------------------------------------------------------------------------------
1. THE WIREFRAME CSS KIT
-------------------------------------------------------------------------------
What it's for: a small set of `.wf-*` classes that let you sketch a screen as
plain greyscale boxes and lines — enough to judge layout, hierarchy, and flow,
not enough to judge color or type. Append this to the plan playbook's §0
`<style>` block; it reuses that block's custom properties (`--surface`,
`--border`, `--fg`, `--muted`, `--space-*`) instead of any new hardcoded color,
which is the whole point (see below).

    /* ---- WIREFRAME KIT — append to plan §0's <style> block ---- */
    .wf-screens { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: var(--space-3); margin: var(--space-3) 0; }
    .wf { background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
      overflow: hidden; font-size: 0.85em; }
    .wf-bar { display: flex; align-items: center; gap: 6px; padding: 6px 10px;
      border-bottom: 1px solid var(--border); color: var(--muted); }
    .wf-dot { width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--border); }
    .wf-body { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .wf-row { display: flex; gap: 8px; align-items: center; }
    .wf-col { display: flex; flex-direction: column; gap: 8px; flex: 1; }
    .wf-block { background: color-mix(in srgb, var(--fg) 8%, var(--surface));
      border-radius: 6px; height: 44px; }
    .wf-block.tall { height: 88px; }
    .wf-line { background: color-mix(in srgb, var(--fg) 16%, var(--surface));
      border-radius: 3px; height: 8px; }
    .wf-line.short { width: 40%; }
    .wf-line.med { width: 65%; }
    .wf-btn { display: inline-block; border: 1px solid var(--fg-secondary); border-radius: 6px;
      padding: 3px 12px; font-size: 0.9em; color: var(--fg); }
    .wf-btn.primary { background: var(--fg); color: #fff; border-color: var(--fg); }
    .wf-input { border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px;
      color: var(--muted); flex: 1; }
    .wf-label { font-size: 0.8em; color: var(--muted); text-transform: uppercase;
      letter-spacing: 0.04em; }
    .wf-caption { font-size: 0.85em; color: var(--muted); padding: 6px 12px 10px; }
    .wf-note { border-left: 2px solid var(--accent); padding-left: 10px; font-size: 0.9em;
      color: var(--muted); }

`.wf-block` and `.wf-line` deliberately use `color-mix(in srgb, var(--fg) N%,
var(--surface))` rather than a new grey hex literal — an earlier draft of this
kit used raw `#f1efe7` / `#e8e6dc` fills, which is exactly the drift this
playbook exists to prevent: change `--fg` or `--surface` and those hardcoded
greys silently stop matching, while `color-mix()` tracks the palette
automatically. No `color-mix()` support in your target? Fall back to
`var(--border)` for both rather than inventing a new color.

The constraint is deliberate, not a limitation you work around: greyscale
wireframes get critiqued for layout and flow — is the button in the right
place, does the empty state make sense — because there is nothing else to
react to. Add real color and type and a reviewer critiques color and type
instead; the planning round quietly becomes a design-polish round before
anyone agreed the layout is right. Decision 2 of the approved plan
(`.brain/features/planning-ux/planning-ux.md`) chose greyscale-by-default for
this reason, with one escape hatch: an `<img>` reference — an existing
screenshot, a design comp that already exists, or a mockup too visually dense
to fake in boxes-and-lines (a chart, a photo, a brand lockup) — gets pin-drop
annotation instead (section 6). Reach for it only when the thing genuinely
can't be sketched, not because sketching is more work than pasting an image.

-------------------------------------------------------------------------------
2. SCREEN INVENTORY
-------------------------------------------------------------------------------
What it's for: one wireframe per screen the plan touches, each labeled with
the screen name and the state it shows, laid out in a `.wf-screens` grid. The
rule this section exists to enforce: a screen the plan changes but does not
show is a screen the reviewer cannot approve — they can only guess at it, or
approve the plan text and discover the layout later, which defeats the entire
point of a mockup review.

Worked example — a notification-settings feature touching two screens:

    <section id="screens">
      <h2>Screens</h2>
      <div class="wf-screens">
        <div class="wf">
          <div class="wf-bar"><span class="wf-dot"></span><span class="wf-dot"></span>
            <span>Settings / Notifications</span></div>
          <div class="wf-body">
            <div class="wf-label">Notifications · default</div>
            <div class="wf-line med"></div>
            <div class="wf-row">
              <div class="wf-col"><div class="wf-line short"></div><div class="wf-block"></div></div>
              <div class="wf-col"><div class="wf-line short"></div><div class="wf-block"></div></div>
            </div>
            <div class="wf-row"><span class="wf-btn primary">Add channel</span>
              <span class="wf-btn">Manage</span></div>
          </div>
          <div class="wf-caption">Default — two channels already configured.</div>
        </div>
        <div class="wf">
          <div class="wf-bar"><span class="wf-dot"></span><span class="wf-dot"></span>
            <span>Settings / Notifications</span></div>
          <div class="wf-body">
            <div class="wf-label">Notifications · empty</div>
            <div class="wf-block tall"></div>
            <div class="wf-row"><span class="wf-btn primary">Add your first channel</span></div>
          </div>
          <div class="wf-caption">Empty — no channels configured. The state a plan
            most often forgets to design.</div>
        </div>
      </div>
    </section>

This plan also touches an "Add channel" modal reachable from either state
above — its wireframe belongs in this same grid, captioned `Add channel ·
default`. Two wireframes here because the settings screen's layout genuinely
differs by state; the modal gets one, because its doesn't. Show as many as
each screen needs to be judged — not mechanically one-per-screen, not every
state combinatorially.

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
4. USER-JOURNEY FLOW
-------------------------------------------------------------------------------
What it's for: a mermaid flowchart of how a person actually moves between the
screens in section 2 — the trigger on every edge, not just where they land —
including the branches where they hit an error or give up, not only the happy
path. Reuse `plan`'s mermaid conventions exactly: `flowchart TD` (top-down, so
nodes stay large and click-annotatable, not compressed into an LR pipeline),
wrapped in `<pre class="mermaid">` to degrade offline, sharing the one CDN
`<script type="module">` import the plan's big-picture diagram already added.

    <pre class="mermaid">
    flowchart TD
      A[Reviewer opens Settings] --> B{Any channels configured?}
      B -->|no| C[Empty state: 'Add your first channel']
      B -->|yes| D[Default state: channel list]
      C -->|clicks Add channel| E[Add channel modal]
      D -->|clicks Add channel| E
      D -->|clicks Manage| F[Edit existing channel]
      E -->|Save| G{Save succeeds?}
      G -->|yes| D
      G -->|no| H[Inline field error]
      H -->|retries| E
      H -->|gives up| I[Closes modal — abandons]
      E -->|Cancel| I
    </pre>

Do not confuse this with `plan` §12's golden-path sequence diagram — different
questions, different diagram types, on purpose. The golden path is what the
SYSTEM does (Browser -->> Worker -->> KV); this flow is what the USER does
(clicks, decisions, dead ends). A plan that adds a screen needs both: the
sequence diagram proves the request works, this one proves the human can get
through it, including when something goes wrong.

-------------------------------------------------------------------------------
5. VARIANT DECISION CARDS
-------------------------------------------------------------------------------
What it's for: when two layouts are both defensible, don't describe them —
show them, side by side, as two wireframes inside one decision card, and let
the reviewer click instead of reading prose about tradeoffs they can't
picture. This reuses `plan` §8's decision-card markup, `data-brain-action`
rule, `queueDecision(...)` helper, and queueKey discipline VERBATIM — it is
the same mechanism with wireframes standing in for the tradeoff table's rows,
not a second mechanism.

    <div class="decision-card" id="decision-nav-layout" data-brain-action>
      <p><strong>1. Sidebar or top-tab navigation for the settings screen?</strong></p>
      <div class="wf-screens">
        <label>
          <input type="radio" name="decision-nav-layout" id="opt-sidebar"
            value="Sidebar navigation" checked data-brain-action>
          <div class="wf">
            <div class="wf-body">
              <div class="wf-row">
                <div class="wf-col"><div class="wf-line short"></div>
                  <div class="wf-line short"></div><div class="wf-line short"></div></div>
                <div class="wf-col"><div class="wf-block tall"></div></div>
              </div>
            </div>
            <div class="wf-caption">Sidebar nav <span class="tag-recommended">(recommended)</span></div>
          </div>
        </label>
        <label>
          <input type="radio" name="decision-nav-layout" id="opt-toptabs"
            value="Top-tab navigation" data-brain-action>
          <div class="wf">
            <div class="wf-body">
              <div class="wf-row"><span class="wf-btn primary">Notifications</span>
                <span class="wf-btn">Billing</span><span class="wf-btn">Team</span></div>
              <div class="wf-block"></div>
            </div>
            <div class="wf-caption">Top-tab nav</div>
          </div>
        </label>
      </div>
      <button type="button" class="btn-queue" data-brain-action
        onclick="queueDecision('decision-nav-layout',
          'Sidebar or top-tab navigation for the settings screen?')">
        Queue answer
      </button>
      <span class="queue-ack" id="ack-decision-nav-layout"></span>
    </div>

Reuse the SAME `queueDecision` `<script>` from `plan` §8 (one per document,
shared by every card) — don't write a second copy. `label`/`input` are
already native-skipped (section 6), so they need no `data-brain-action`
strictly; it's kept anyway to match `plan` §8's convention of marking every
interactive piece explicitly. The outer `div` and the button are NOT native,
so their `data-brain-action` is load-bearing, not decorative.

-------------------------------------------------------------------------------
6. HOW A REVIEWER ANNOTATES A MOCKUP
-------------------------------------------------------------------------------
What it's for: the exact click-to-annotation behavior from `lib/review/sdk.js`
— get this wrong and reviewer clicks either do nothing or do the wrong thing.

- **Explore mode (default, annotate off).** Ordinary elements do nothing on
  click. Two exceptions: a rendered mermaid diagram opens a pan/zoom lightbox
  on plain click, and a reference `<img>` (below) shows a hover "⤢" button
  that opens the pin-drop lightbox.
- **Annotate mode (toggled on).** A click on any element NOT matching the
  SDK's `NATIVE_SKIP_SELECTOR` (`button, input, select, textarea, option,
  label, summary, a[href], [contenteditable]`) and not inside
  `[data-brain-action]`/`[data-brain-ui]` is captured (`shouldSkip` in
  `sdk.js`) as an ELEMENT annotation: a CSS-path selector, a capped text
  excerpt, and a capped `outerHTML` locator hint, tag `"element"`. This is
  exactly what you want for ordinary wireframe scenery — a `.wf-block` or
  `.wf-line` the reviewer thinks is misplaced SHOULD be swallowed this way,
  because that swallow IS the annotation. Never put `data-brain-action` on
  plain wireframe pieces; it would make them un-annotatable.
- **Where `data-brain-action` matters.** Only on CUSTOM elements not already
  in `NATIVE_SKIP_SELECTOR` that carry their own click behavior you don't want
  intercepted — a decision-card's outer `div`, a "Queue answer" button, or any
  `.wf-btn`/`.wf-input` you script a real handler onto. Radios, checkboxes,
  and labels are native and already skipped regardless of the attribute; the
  kit's plain `.wf-btn`/`.wf-input` spans used as pure scenery (no handler)
  are fine left bare — they're meant to be annotated, not clicked.
- **SVG diagram-node annotation.** A click inside a rendered diagram (section
  4's flow, or `plan` §5's big picture) does NOT annotate a random generated
  SVG path — it walks up from the click target to the nearest `<g id="...">`
  that is either a mermaid node (class `node`) or carries a non-empty text
  label, and queues tag `"diagram-node"` with `queueKey =
  "<diagramId>:<nodeId>"` (re-annotating the same node replaces, not stacks).
  No matching node found → falls back to annotating the whole `<svg>` as a
  generic element. Practical effect: a reviewer can click the `E -->|Save| G`
  node in section 4's flowchart and say "this should also handle a timeout,"
  anchored to that exact node — not to "the diagram" as one blob.
- **Reference-image pin-drop (the escape hatch from section 1).** Applies
  only to real `<img>` elements, never the wireframe kit (it has no images).
  An `<img>` qualifies when both rendered dimensions are >= 80px, it isn't
  inside an `a[href]` (a linked image is navigation, not a reference), and
  isn't `data-brain-no-zoom` (`data-brain-zoom` force-opts in regardless of
  size). Hovering shows the same "⤢" affordance as a diagram. Which click
  opens the lightbox depends on WHERE and WHICH MODE, and the difference
  matters: the hover "⤢" button opens it in EITHER mode (it is
  `data-brain-ui`, so the annotation handler skips it), while a plain click
  on the image ITSELF opens it only in explore mode — in annotate mode that
  same click falls through to the generic element handler and queues an
  ordinary `"element"` annotation on the `<img>` instead, because `<img>`
  is not in `NATIVE_SKIP_SELECTOR`. Tell reviewers to use the "⤢" button.
  Opening it posts the image up to the review chrome (the artifact iframe
  can't open the lightbox itself), which opens the shared
  `BrainLightbox`. The reviewer drops a numbered pin at an x%/y% coordinate
  with a note; it queues tag `"reference-image"`, `target: {selector, alt, x,
  y, note}`, `queueKey = "refimg:<selector>:<x>:<y>"` (re-pinning the same
  spot replaces). Use this only for a real image attachment — never as a
  workaround for a wireframe you didn't want to build in HTML.

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
