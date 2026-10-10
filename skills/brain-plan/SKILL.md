---
name: brain-plan
description: "writing any plan/proposal/design artifact for human review"
---
PLAN ARTIFACT PLAYBOOK
=======================

You are about to write a plan/proposal/design as ONE standalone HTML file that a
human will review inside "brain review" (an iframe'd artifact + sidebar showing
brain memory: prior plans, timeline, screenshots, feature state). This is not a
markdown doc and not a chat message — it is a small web page. Read this whole
playbook before writing anything, then follow the section structure in order.

Before you write: if this plan will carry any decision card and you have not
run `brain playbook grill`, stop and run it. It settles what you can settle
with the human while the design is still soft, and its memory check keeps you
from asking a question this repo already answered. Grilling after the artifact
exists is not grilling — it is asking someone to ratify a design.

Four of those sections are conditional — 3, 6, 7, and 16. Each names the
playbook that owns it, because the standard is too long to inline here and
too important to guess at:

- Sections 3 (product brief) and 7 (product decisions) fire on any USER-FACING
  change — a screen, a CLI surface someone invokes, an output format, a
  workflow. Read `brain playbook product` before writing them.
- Section 6 (UI mockups + UX flows) fires when the plan adds or changes a
  SCREEN. Read `brain playbook ux` before writing it.
- Section 16 (AI addendum) fires when the plan touches PROMPTS, MODELS, OR
  AGENTS. Read `brain playbook ai` before writing it.

Skip a conditional section when it does not apply — an empty ceremony section
teaches the next agent that these are boxes to fill rather than work to do.

Why this matters: a reviewer should be able to grasp what's going on, what needs
deciding, and the big picture, WITHOUT reading code — and every decision you need
from them should be answerable by clicking, not by typing an essay.

PICK A TIER FIRST
-----------------

Seventeen sections is right for a feature that spans several layers and carries
real architectural risk. On a two-file change it is overhead, and the same
warning applies as to an empty conditional section: ceremony teaches the next
agent that these are boxes to fill.

Two tiers. Choose before writing, and state which one in the header strip
(section 1) so the reviewer can push back in a single annotation:

- **small** — sections 1 (header), 2 (TL;DR), 4 (context), 8 (decisions),
  10 (plan of record), 11 (files that change). Six sections. Use when the shape
  is already understood and what you need is a decision and a record of it.
- **full** — every section that applies, conditionals included. Use when the
  work spans layers, changes a user-facing surface, or carries a decision that
  is expensive to reverse.

Two rules bind the choice:

- **Decisions are never cut.** Section 8 is in both tiers. A plan with nothing
  to decide did not need a review session; a plan that hides its decisions to
  look small is the failure this tier exists to prevent.
- **A conditional section still fires in small.** If the change is user-facing,
  the product brief applies whatever the tier — reach for full instead of
  dropping it. Tier controls how much you write about the shape, never whether
  the case for building it gets made.

When in doubt, write small and let the review round tell you what is missing.
Adding a section between rounds is cheap; a reviewer's attention spent on eleven
sections that did not need writing is not.

-------------------------------------------------------------------------------
0. SHARED FOUNDATIONS — write this once, in <head>, use it everywhere below
-------------------------------------------------------------------------------

One file, inline CSS, no build step. Define a small set of reusable classes up
front so every section below is just HTML using them. This is a complete,
copy-pasteable starting <style> block:

    <style>
      :root {
        --bg: #faf9f5; --surface: #ffffff; --fg: #141413; --fg-secondary: #3d3d3a;
        --muted: #73726c; --border: #dedcd1; --highlight: #fff7ca; --accent: #d97757;
        --space-2: 8px; --space-3: 16px; --space-4: 24px; --space-6: 40px;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
          Helvetica, Arial, sans-serif;
        font-size: 16px; background: var(--bg); color: var(--fg); line-height: 1.6;
        max-width: 72ch; margin: 0 auto; padding: var(--space-6) var(--space-4);
      }
      h1, h2, h3 {
        font-family: Charter, "Iowan Old Style", "Palatino Linotype", Georgia, serif;
        font-weight: 600; line-height: 1.25; color: var(--fg);
      }
      h1 { font-size: 1.75em; }
      h2 { font-size: 1.3em; font-weight: 500; margin-top: var(--space-6);
        border-bottom: 1px solid var(--border); padding-bottom: var(--space-2); }
      h3 { font-size: 1.05em; font-weight: 500; }
      p, li { color: var(--fg-secondary); }
      mark, .highlight { background: var(--highlight); color: var(--fg); padding: 0 2px; }
      .chip { display: inline-block; padding: 2px 10px; border-radius: 999px;
        font-size: 0.8em; font-weight: 600; border: 1px solid var(--border); }
      .chip-status-draft { background: var(--surface); color: var(--muted); }
      .chip-status-in-review { background: var(--highlight); color: var(--fg);
        border-color: var(--highlight); }
      .chip-status-reviewed { background: var(--fg); color: #fff; border-color: var(--fg); }
      .chip-high { color: var(--accent); border-color: var(--accent); }
      .chip-med { color: var(--fg-secondary); }
      .chip-low { color: var(--muted); }
      .decision-card { background: var(--surface); border: 1px solid var(--border);
        border-radius: 10px; padding: var(--space-4); margin: var(--space-4) 0; }
      table { width: 100%; border-collapse: collapse; margin: var(--space-3) 0;
        background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
        overflow: hidden; }
      th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid
        var(--border); vertical-align: top; }
      tr:last-child td { border-bottom: none; }
      .tag-recommended { color: var(--accent); font-weight: 600; }
      .btn-queue, .btn-approve, .btn-request-changes {
        border: none; border-radius: 10px; padding: 8px 16px; font-weight: 600;
        cursor: pointer; font-size: 0.95em;
      }
      .btn-queue, .btn-approve { background: var(--fg); color: #fff; }
      .btn-request-changes { background: transparent; color: var(--fg);
        border: 1px solid var(--border); }
      .queue-ack { margin-left: var(--space-3); font-size: 0.9em; color: var(--muted); }
      .checklist { list-style: none; padding: 0; }
      .checklist li { margin: var(--space-2) 0; }
      pre.mermaid { text-align: center; }
      pre.mermaid svg { display: block; margin: 0 auto; }
      .arch-diagram .box { fill: var(--surface); stroke: var(--fg-secondary); stroke-width: 2; }
      .arch-diagram .box-label { fill: var(--fg); font-size: 14px; }
      .arch-diagram .arrow { stroke: var(--muted); stroke-width: 2;
        marker-end: url(#arrow); }
    </style>

Every section below assumes this block (or your own equivalent) is already in
<head>. Do not link an external stylesheet — inline it.

Palette discipline (read once, applies everywhere below): warm vellum
background (--bg), ink text (--fg) with a softer --fg-secondary for body copy
and --muted for de-emphasized text, hairline --border everywhere a rule or
card edge is needed, --highlight (a pale yellow) reserved for emphasized or
highlighted phrases, and exactly ONE accent (--accent, terra cotta) reserved
for "(recommended)" markers and small emphasis — never a second brand color,
never a saturated red/green/amber, never a gradient. This is a fixed,
committed light palette (no @media (prefers-color-scheme: dark) override) —
a plan is a piece of editorial writing, not a themed app surface, and it
should look the same read next to the review sidebar every time.

-------------------------------------------------------------------------------
1. HEADER STRIP
-------------------------------------------------------------------------------
What it's for: instant orientation — title, when, which feature this plan is
for, the tier you chose, and where the review stands right now (draft /
in-review / reviewed, which round). Pull the status/round values from
"brain plans view <slug>" if this plan already exists, otherwise start at
draft, round 0.

The tier belongs here and nowhere else. Stating it makes the scope of the
artifact itself reviewable: a reviewer who thinks a small plan should have been
full says so in one annotation, before reading eleven sections that are missing.

    <header>
      <h1>Auth session refactor</h1>
      <div>
        <span>2026-07-14</span> ·
        <span>feature: auth-sessions</span> ·
        <span class="chip chip-low">tier: small</span> ·
        <span class="chip chip-status-in-review">in-review</span> ·
        <span>round 2</span>
      </div>
    </header>

-------------------------------------------------------------------------------
2. TL;DR
-------------------------------------------------------------------------------
What it's for: the elevator pitch. A reviewer who reads only this paragraph
should know what you're doing and why now. Three sentences, hard cap.

    <section id="tldr">
      <h2>TL;DR</h2>
      <p>We're moving session storage from in-memory to Cloudflare KV so sessions
      survive Worker restarts and scale past a single isolate. Doing this now
      because the auth feature is blocked on it.</p>
    </section>

-------------------------------------------------------------------------------
3. PRODUCT BRIEF — conditional: any user-facing change
-------------------------------------------------------------------------------
What it's for: the case that this is the right thing to build, made BEFORE the
technical plan exists. Problem + evidence, the user and their job, one success
metric with a number, non-goals, scope tiers (thin / complete / gold), and
prior art. Written afterwards it is a justification, not a decision.

Read `brain playbook product` and follow it — that playbook owns this section
and section 7. Skip both entirely for internal refactors, dependency bumps,
and pure infrastructure. If you are unsure whether the change is user-facing,
it is: someone invokes it, reads its output, or sees it.

The scope tiers matter most to the reviewer, so make them map onto section
10's phase boundaries — that is what lets a human approve a smaller thing
without forcing another review round.

-------------------------------------------------------------------------------
4. CONTEXT — cite brain memory
-------------------------------------------------------------------------------
What it's for: ground the plan in what already happened. Before writing this
section, actually run "brain plans", "brain progress", and "brain features
view <slug>" and pull real slugs/dates/quotes in — do not paraphrase from
memory. Name the prior plan slug, the last checkpoint date + summary, and the
relevant feature's current status.

    <section id="context">
      <h2>Context</h2>
      <p>Per plan 2026-07-01-auth-mvp, the MVP shipped with in-memory sessions
      as a known shortcut. The 2026-07-12 checkpoint ("auth MVP shipped,
      sessions lost on redeploy") flags this as the next blocker. Feature
      auth-sessions is currently in-progress, owner sean.</p>
    </section>

-------------------------------------------------------------------------------
5. BIG PICTURE — one architecture diagram
-------------------------------------------------------------------------------
What it's for: components + data flow at a glance, not class trivia. One
diagram. See the "MERMAID GUIDANCE" section below for the flowchart snippet
and the offline-safe inline-SVG alternative. Use a flowchart here (top-down or
left-right); save sequence diagrams for the golden path section (12), and the
user-journey flow — what the PERSON does, not what the system does — for
section 6.

-------------------------------------------------------------------------------
6. UI MOCKUPS + UX FLOWS — conditional: the plan adds or changes a screen
-------------------------------------------------------------------------------
What it's for: making the interface approvable before it is built. A greyscale
wireframe per screen, a screen-state matrix (empty / loading / error /
success), and a user-journey flow diagram — what the PERSON does, as opposed
to section 12's golden path, which is what the system does. Layout variants
that are genuinely a coin flip become decision cards here, side by side.

Read `brain playbook ux` and follow it — that playbook owns this section and
ships the wireframe CSS kit that belongs in section 0's style block. Skip this
section when nothing visual changes; a CLI's output SHAPE is a product surface
but belongs in the product brief, not here.

The rule that makes it worth doing: a screen the plan changes but does not
show is a screen the reviewer cannot approve. The one it exists to catch: the
empty and error states, which plans forget and users hit first.

-------------------------------------------------------------------------------
7. PRODUCT DECISIONS — conditional: any user-facing change
-------------------------------------------------------------------------------
What it's for: the questions about WHAT gets built, answered before the
questions about HOW. A bad product answer invalidates every technical card
below it, so these come first and get their own section.

Same markup as section 8 (decision cards, radio groups, tradeoff tables,
`queueDecision`) — the difference is the framing and the standard:

- The question is in the user's terms, not the implementation's. "Should a
  reviewer be able to approve part of a plan?" is a product decision; "should
  approval state be a column or a separate table?" is a technical one.
- Every card carries a recommendation WITH a rationale. A card that lists
  options and takes no position is the planner outsourcing its job to the
  reviewer.

`brain playbook product` section 7 has the full standard and a worked card.

-------------------------------------------------------------------------------
8. TECHNICAL DECISIONS NEEDED — numbered decision cards
-------------------------------------------------------------------------------
What it's for: this is the section that actually needs the human. Every open
question that has a shortlist of options becomes a decision card: 1-2
sentences of context, a radio group, a tradeoff table, one option pre-checked
and labeled "(recommended)", and a "Queue answer" button. The reviewer answers
by clicking — never by typing a paragraph. Questions that don't yet have a
shortlist go in section 15 (Open questions) instead.

FULL WORKING SNIPPET (self-contained — copy, then adjust ids/copy per card):

    <section id="decisions">
      <h2>Decisions needed</h2>

      <div class="decision-card" id="decision-cache-strategy" data-brain-action>
        <p><strong>1. Which cache invalidation strategy for the session store?</strong></p>
        <table>
          <thead><tr><th></th><th>Option</th><th>Pros</th><th>Cons</th></tr></thead>
          <tbody>
            <tr>
              <td><input type="radio" name="decision-cache-strategy" id="opt-ttl"
                value="TTL expiry (5 min)" checked data-brain-action></td>
              <td><label for="opt-ttl">TTL expiry (5 min)
                <span class="tag-recommended">(recommended)</span></label></td>
              <td>Simple, no invalidation logic</td>
              <td>Up to 5 min of staleness</td>
            </tr>
            <tr>
              <td><input type="radio" name="decision-cache-strategy" id="opt-write-through"
                value="Write-through invalidation" data-brain-action></td>
              <td><label for="opt-write-through">Write-through invalidation</label></td>
              <td>Always fresh</td>
              <td>More moving parts, coupling to the write path</td>
            </tr>
          </tbody>
        </table>
        <button type="button" class="btn-queue" data-brain-action
          onclick="queueDecision('decision-cache-strategy',
            'Which cache invalidation strategy for the session store?')">
          Queue answer
        </button>
        <span class="queue-ack" id="ack-decision-cache-strategy"></span>
      </div>
    </section>

    <script>
      function queueDecision(cardId, question) {
        var card = document.getElementById(cardId);
        var checked = card.querySelector('input[type="radio"]:checked');
        if (!checked) return;
        var choice = checked.value;
        if (window.brain && typeof window.brain.queuePrompt === "function") {
          window.brain.queuePrompt({
            tag: "decision",
            queueKey: cardId,
            prompt: question + ": " + choice,
            target: { type: "decision", question: question, choice: choice }
          });
        }
        var ack = document.getElementById("ack-" + cardId);
        if (ack) ack.textContent = "Queued: " + choice;
      }
    </script>

Notes:
- The card's outer div and every input/button carry data-brain-action so
  annotate mode (click-to-annotate elsewhere on the page) never intercepts
  these clicks — without it, a click meant to select an option would instead
  get captured as an element annotation.
- queueKey (here, the card's own id) means re-clicking "Queue answer" after
  changing the radio REPLACES the queued item instead of stacking a duplicate
  — the reviewer can change their mind before sending.
- This works only inside a brain review session. Opened standalone (double-
  clicked the file), window.brain.queuePrompt is a stub that logs to the
  console and does nothing else — the button will not throw, it just quietly
  no-ops. That is by design; do not add a try/catch around it.
- One <script> block per file is enough — reuse queueDecision for every card.

-------------------------------------------------------------------------------
9. INTERACTIVE REVIEW COMPONENTS
-------------------------------------------------------------------------------
What it's for: decision cards (section 8) cover shortlist-of-options questions.
This section covers the rest of what a plan needs to be truly clickable: lists
that the reviewer edits in place (add/remove/rewrite an item without typing a
prompt), the submit discipline that keeps those edits from spamming duplicate
prompts, and a lavish-axi input pattern worth porting. Read
lavish-axi's own "input" playbook for the underlying philosophy if you have
access to it; this section adapts that philosophy to the window.brain API and
the list-edit prompt tag.

--- 9.1 EDITABLE LIST COMPONENT (the flagship pattern) ---

Four sections in this playbook are fundamentally editable lists: Plan of
record (10), Error paths (13, a table), Testing plan (14), and Open questions
(15). Instead of leaving them as static markup the reviewer can only
free-annotate, give every item a small x / restore toggle and every section an
"+ Add item" row, and let the reviewer double-click an item to rewrite it
in place. All three actions queue a "list-edit" prompt; none of them require
the reviewer to type anything unless they're adding or rewriting text.

Add ONE script block (reuse it for every section — it is written once,
delegated via event listeners on document, and driven entirely by data
attributes, so it needs no per-item onclick wiring):

    <script>
      (function () {
        function queueList(section, queueKey, prompt, action, item, index) {
          if (window.brain && typeof window.brain.queuePrompt === "function") {
            window.brain.queuePrompt({
              tag: "list-edit",
              queueKey: queueKey,
              prompt: prompt,
              target: { type: "list-edit", section: section, action: action, item: item, index: index }
            });
          }
        }

        function slugify(s) {
          return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "").slice(0, 60) || "item";
        }

        function itemText(el) {
          var t = el.querySelector("[data-item-text]");
          return (t || el).textContent.trim();
        }

        function addBadge(el, cls, label) {
          var badge = el.querySelector("." + cls);
          if (!badge) {
            badge = document.createElement("span");
            badge.className = "item-badge " + cls;
            el.appendChild(badge);
          }
          badge.textContent = label;
        }

        function toggleRemoved(item, section) {
          var index = Number(item.getAttribute("data-brain-item"));
          var text = itemText(item);
          var removed = item.classList.toggle("item-removed");
          var xBtn = item.querySelector(".item-x");
          var restoreBtn = item.querySelector(".item-restore");
          if (xBtn) xBtn.hidden = removed;
          if (restoreBtn) restoreBtn.hidden = !removed;
          var key = section + ":remove:" + index;
          if (removed) {
            queueList(section, key, "Remove from " + section + ": \"" + text + "\"", "remove", text, index);
          } else {
            // Restore/cancel idiom — see prose below for why this is action
            // "edit", not a delete-the-queued-item call (no such API exists).
            queueList(section, key, "Cancelled: keep \"" + text + "\" in " + section, "edit", text, index);
          }
        }

        function startEdit(item, section) {
          if (item.classList.contains("item-removed")) return;
          var span = item.querySelector("[data-item-text]");
          if (!span || span.isContentEditable) return;
          var before = span.textContent;
          span.setAttribute("contenteditable", "true");
          span.focus();

          function commit() {
            span.removeAttribute("contenteditable");
            span.removeEventListener("blur", commit);
            span.removeEventListener("keydown", onKey);
            var text = span.textContent.trim();
            if (!text || text === before.trim()) { span.textContent = before; return; }
            var index = Number(item.getAttribute("data-brain-item"));
            addBadge(item, "item-badge-edited", "edited");
            queueList(section, section + ":edit:" + index,
              "Edit " + section + " item " + index + ": \"" + text + "\"", "edit", text, index);
          }
          function onKey(ev) {
            if (ev.key === "Enter") { ev.preventDefault(); span.blur(); }
            else if (ev.key === "Escape") { span.textContent = before; ev.preventDefault(); span.blur(); }
          }
          span.addEventListener("blur", commit);
          span.addEventListener("keydown", onKey);
        }

        function commitAdd(addRow) {
          var section = addRow.getAttribute("data-brain-section-add");
          var input = addRow.querySelector(".list-add-input");
          var text = input.value.trim();
          if (!text) return;
          var list = document.querySelector("[data-brain-section=\"" + section + "\"]");
          var tpl = list && list.querySelector("template");
          if (!list || !tpl) return;
          var node = document.importNode(tpl.content, true);
          var item = node.querySelector("[data-brain-item]") || node.firstElementChild;
          item.setAttribute("data-brain-item", "new");
          var span = item.querySelector("[data-item-text]");
          if (span) span.textContent = text;
          item.classList.add("item-proposed");
          addBadge(item, "item-badge-proposed", "proposed");
          list.insertBefore(node, tpl.nextSibling);
          input.value = "";
          queueList(section, section + ":add:" + slugify(text),
            "Add to " + section + ": \"" + text + "\"", "add", text, null);
        }

        document.addEventListener("click", function (ev) {
          var xBtn = ev.target.closest(".item-x");
          var restoreBtn = ev.target.closest(".item-restore");
          if (xBtn || restoreBtn) {
            var item = ev.target.closest("[data-brain-item]");
            var section = ev.target.closest("[data-brain-section]");
            if (item && section) toggleRemoved(item, section.getAttribute("data-brain-section"));
            return;
          }
          var addBtn = ev.target.closest(".list-add-btn");
          if (addBtn) {
            var addRow = ev.target.closest("[data-brain-section-add]");
            if (addRow) commitAdd(addRow);
          }
        });

        document.addEventListener("dblclick", function (ev) {
          var item = ev.target.closest("[data-brain-item]");
          if (!item) return;
          var section = item.closest("[data-brain-section]");
          if (section) startEdit(item, section.getAttribute("data-brain-section"));
        });

        document.addEventListener("keydown", function (ev) {
          if (ev.key !== "Enter") return;
          var addRow = ev.target.closest("[data-brain-section-add]");
          if (addRow && ev.target.classList.contains("list-add-input")) {
            ev.preventDefault();
            commitAdd(addRow);
          }
        });
      })();
    </script>

Add these classes to the shared style block (section 0):

    .item-x, .item-restore, .list-add-btn { cursor: pointer; border: 1px solid var(--border);
      background: var(--surface); border-radius: 6px; font-size: 0.85em; padding: 1px 8px;
      color: var(--fg-secondary); }
    /* item-x and item-restore are told apart by their label text ("x" vs
       "restore"), not by color — this palette keeps color-coding to a single
       accent reserved for recommended/emphasis, so state is legible without
       relying on red/green. */
    /* Do not add "display: none" to .item-restore: the template's hidden
       attribute already hides it via the UA stylesheet, and JS only ever
       toggles the hidden PROPERTY (item.hidden = true/false) — an
       unconditional class-based display:none would fight that toggle and
       the button would never reappear after a removal. */
    [data-item-text] { cursor: text; }
    .item-removed { opacity: 0.5; }
    .item-removed [data-item-text] { text-decoration: line-through; }
    .item-edited [data-item-text] { border-bottom: 2px dotted var(--accent); }
    .item-badge { font-size: 0.75em; color: var(--muted); margin-left: 6px; font-style: italic; }
    .item-badge-proposed { color: var(--accent); }
    .item-proposed { border-left: 2px dashed var(--accent); padding-left: 6px; }
    .list-add-row { display: flex; gap: 8px; margin-top: var(--space-2); }
    .list-add-input { flex: 1; padding: 6px 10px; border: 1px solid var(--border);
      border-radius: 6px; background: var(--surface); color: var(--fg); }

Applied to Open questions (15) — the simplest case, a plain <ul>:

    <section id="open-questions" data-brain-section="open-questions">
      <h2>Open questions</h2>
      <ul>
        <template>
          <li data-brain-item>
            <span data-item-text data-brain-action></span>
            <span class="item-controls">
              <button type="button" class="item-x" data-brain-action title="Remove">x</button>
              <button type="button" class="item-restore" data-brain-action hidden title="Restore">restore</button>
            </span>
          </li>
        </template>
        <li data-brain-item="0">
          <span data-item-text data-brain-action>Do we need per-region KV replication?</span>
          <span class="item-controls">
            <button type="button" class="item-x" data-brain-action title="Remove">x</button>
            <button type="button" class="item-restore" data-brain-action hidden title="Restore">restore</button>
          </span>
        </li>
      </ul>
      <div class="list-add-row" data-brain-section-add="open-questions">
        <input type="text" class="list-add-input" data-brain-action placeholder="Add an open question..." />
        <button type="button" class="list-add-btn" data-brain-action>+ Add item</button>
      </div>
    </section>

The <template> inside the list is inert (browsers never render or select
template content, so it is never mistaken for a real item) — it is only there
so commitAdd() has a real DOM fragment to clone, meaning a new list-of-cards
markup shape (say, Plan of record's <strong>-led phases) is supported for
free just by giving each section its own template. Adapting to the other
three sections:

- Plan of record (7, an <ol> of phases): same shape, data-brain-item="0",
  "1", "2" per <li>, [data-item-text] wraps the phase description (keep the
  "Phase N -" strong label outside data-item-text if you want the label
  itself to stay stable across edits — a reviewer editing the acceptance
  criteria shouldn't accidentally retype "Phase 2 -").
- Testing plan (11, checkboxes): [data-item-text] wraps only the label text,
  not the checkbox — the checkbox stays a native <input type="checkbox">
  (no data-brain-action needed, see 6.2) so it keeps working as a plain
  clickable checklist item. Double-clicking text inside a <label> also
  toggles the checkbox twice on the way to becoming editable (click, click,
  dblclick all fire) — harmless, it nets back to its original checked state
  before edit mode opens, but call it out in a code comment so nobody
  "fixes" it with a preventDefault that would break click-to-check.
- Error paths (10, a table): data-brain-section goes on the <tbody>,
  data-brain-item on each <tr>, [data-item-text] on the "Failure" <td> (the
  cell that best names the row for remove/restore prompts). Row-level
  remove/restore is enough here — don't try to inline-edit four columns at
  once; the add-row template is a single <tr><td colspan="4"> with one text
  input's worth of content, deliberately simpler than the real columns, and
  left "proposed" until the agent reconciles it into real columns.

--- 9.2 THE RESTORE/CANCEL IDIOM (a design decision, stated explicitly) ---

There is no API to un-queue or delete an already-queued prompt — queuePrompt
can only add or, via a repeated queueKey, REPLACE. So "click x, then click
restore" cannot simply vanish the queued removal; it has to replace it with
something the agent reads as "never mind." The idiom this playbook uses:
restore re-queues the SAME queueKey (section:remove:index) with action
"edit", the item text unchanged, and a prompt string that starts literally
with "Cancelled: keep ...". The agent applies this as a no-op — a plain-
language cancellation is unambiguous to read on poll, and reusing action
"edit" (rather than inventing a fourth action the server would not
recognize; list-edit's action is normalized to one of add/remove/edit,
anything else collapses to "edit" anyway) keeps the prompt inside the
existing tag contract with zero new surface. Do not build a separate
"cancel" queueKey alongside the removal's queueKey — that would leave BOTH
the removal and the cancellation queued and stacked (two contradictory
prompts reach the agent instead of one), defeating the entire point of
queueKey replacement.

--- 9.3 PER-QUESTION SUBMIT DISCIPLINE (adapted from lavish's input playbook) ---

This is the rule decision cards (section 8) and the list component above both
already follow; state it explicitly so every future control in a plan
follows it too. The intent, credited to lavish-axi: prevent annotation mode
from eating ordinary form interactions, and prevent the same answer from
reaching the agent as five duplicate, slightly-different prompts because the
reviewer changed their mind four times before sending.

- Native controls — radio, checkbox, input, select, button, label, summary,
  and [contenteditable] elements — are interactive automatically. The SDK's
  annotate-mode click interceptor already skips them (and their descendants)
  by tag/attribute, with zero configuration. They do NOT need
  data-brain-action to behave normally.
- data-brain-action is only for CUSTOM clickable elements — a styled div,
  span, or the item-text span above once you have made double-click rewrite
  it — that are not themselves one of the native elements above. Without it,
  annotate mode intercepts the click as a free-text element annotation
  instead of running your handler.
- Option clicks (radio change, checkbox toggle, dragging a slider, typing in
  a text field) update LOCAL state only. Never call window.brain.queuePrompt
  from inside a change/input handler for a question the reviewer can still
  revise.
- Exactly ONE queued prompt per question, via a per-question submit action
  (a "Queue answer" button, a form onsubmit, or — for a slider — the
  native "change" event, which already only fires once per drag release)
  and a stable queueKey. Re-submitting the same question replaces the
  pending prompt; it never stacks a second one.
- Show the reviewer the difference between "selected locally" (radio
  checked, item struck through) and "queued for the agent" (the queue-ack
  text, the item-badge, the pill in the composer) — section 8's queue-ack
  span and this section's item-badge both exist for this reason.

--- 9.4 OTHER LAVISH INPUT PATTERNS — one worth porting, one deliberately not ---

Effort/risk sliders are worth porting: a native <input type="range"> is
already a native control (6.3), and its "change" event only fires once per
drag release, so it needs no separate submit button — reuse the "decision"
tag (question/choice are both plain strings, and choice can be a stringified
number) rather than inventing a scoring tag the server does not normalize:

    <input type="range" min="1" max="5" value="3" id="effort-phase2"
      oninput="document.getElementById('effort-phase2-out').textContent = this.value"
      onchange="window.brain && window.brain.queuePrompt({ tag: 'decision',
        queueKey: 'effort-phase2', prompt: 'Effort estimate for Phase 2: ' + this.value + '/5',
        target: { type: 'decision', question: 'Effort estimate for Phase 2', choice: String(this.value) } })" />
    <output id="effort-phase2-out">3</output>/5

Do NOT add a fill-in text input for answering an open question. Reviewers
already have a universal free-text path — select the question's own text (or
any other text on the page) and annotate it — so a per-question answer field
would just duplicate that path with a second, less discoverable one. Plans
must never embed one.

Skipped, one line each, with reasons:
- window.lavish.sendQueuedPrompts() (immediate-send from inside the
  artifact) — brain-axi has no equivalent; sending is the chrome composer's
  job by design (it owns the send/end/session lifecycle), not the artifact's.
- lavish's open-ended "data" bag on queuePrompt (arbitrary extra key-value
  payload) — brain-axi's target shapes are a fixed, server-normalized
  whitelist per tag; anything outside a tag's known fields is stripped at
  the trust boundary, so an author-side data bag would silently vanish and
  mislead whoever wrote it.
- data-lavish-question auto-scoping as something THIS playbook teaches —
  brain-axi ports the underlying idea as automatic queueKey derivation
  inside the SDK itself (addendum v5, item 2: radio/checkbox/text derive a
  queueKey from a [data-brain-question] ancestor when none is passed), so
  authors get the behavior for free; this playbook still shows explicit
  queueKey everywhere above because explicit beats derived for a reader
  trying to learn the shape, not because the automatic path is missing.
- a dedicated tag for tradeoff-table option selection distinct from
  "decision" — not needed; section 8 already covers the exact same shape
  (radio group + tradeoff table + one queued choice) and inventing a second
  tag for the same data would just be two names for one thing.

-------------------------------------------------------------------------------
10. PLAN OF RECORD — phased steps with acceptance criteria
-------------------------------------------------------------------------------
What it's for: what you're actually going to do, in order, and how you'll know
each phase is done. Not a task list — acceptance criteria, so "done" is
checkable.

- **Acceptance is a testable behavior**, observable by a verifier driving the
  product or running a named command — "a reload keeps the session", not
  "sessions are robust". A criterion nobody could fail is not one.
- **Each phase states how it will be verified** (a "Verify:" clause). These
  become the `--verify` lines the execute playbook's contract step agrees
  with an independent verifier before any code.
- **Stay at product + high-level design.** Constrain the deliverable, not the
  path: no exact function signatures or line-level edits the implementer
  should discover. Wrong detail pinned upfront cascades into every phase
  built on it; the same goes for section 11 — paths and why, not diffs.

    <section id="plan-of-record">
      <h2>Plan of record</h2>
      <ol>
        <li><strong>Phase 1 — introduce a KV-backed SessionStore.</strong>
          Acceptance: SessionStore implemented for KV; unit tests pass against
          a local KV simulator.
          Verify: run the session-store suite against the simulator.</li>
        <li><strong>Phase 2 — cut over reads, dual-write.</strong>
          Acceptance: reads prefer KV with a fallback to memory; writes go to
          both; zero session-loss errors in staging for 24h.
          Verify: sign in on staging, restart the app, reload — still signed
          in; read the 24h session-error count.</li>
        <li><strong>Phase 3 — remove the in-memory path.</strong>
          Acceptance: in-memory store deleted; all tests green; one week in
          prod with no regression in session-related error rate.
          Verify: grep finds no memory-store import; full suite green.
          <details>
            <summary>Why not do this in one phase?</summary>
            <p>Dual-write gives us a rollback path if KV read latency turns
            out to be a problem under load — cutting straight over would mean
            debugging in prod with no fallback.</p>
          </details>
        </li>
      </ol>
    </section>

-------------------------------------------------------------------------------
11. FILES THAT CHANGE
-------------------------------------------------------------------------------
What it's for: a reviewer scanning the blast radius. One row per path: what
kind of change, and why — not a full diff.

    <section id="files-changed">
      <h2>Files that change</h2>
      <table>
        <thead><tr><th>Path</th><th>Change</th><th>Why</th></tr></thead>
        <tbody>
          <tr><td>src/auth/session-store.ts</td><td>new</td>
            <td>KV-backed implementation</td></tr>
          <tr><td>src/auth/middleware.ts</td><td>edit</td>
            <td>read/write through the new store</td></tr>
          <tr><td>src/auth/memory-store.ts</td><td>delete (phase 3)</td>
            <td>superseded</td></tr>
        </tbody>
      </table>
    </section>

-------------------------------------------------------------------------------
12. GOLDEN PATH — the happy-path walkthrough end to end
-------------------------------------------------------------------------------
What it's for: how a normal request actually flows through the new design,
step by step. A sequence diagram is the natural fit here — see MERMAID
GUIDANCE below for the snippet and the "sequenceDiagram" recommendation.

-------------------------------------------------------------------------------
13. ERROR PATHS
-------------------------------------------------------------------------------
What it's for: the failure modes a reviewer will ask about anyway — surface
them yourself. One row per failure: how it's detected, how it's handled, and
what the user actually sees.

    <section id="error-paths">
      <h2>Error paths</h2>
      <table>
        <thead><tr><th>Failure</th><th>Detected by</th><th>Handled by</th>
          <th>User sees</th></tr></thead>
        <tbody>
          <tr><td>KV lookup miss (expired/evicted)</td>
            <td>null return from the KV get</td>
            <td>middleware treats it as unauthenticated</td>
            <td>redirected to /login</td></tr>
          <tr><td>KV write failure</td>
            <td>thrown exception</td>
            <td>retried once, then dual-writes to memory for this request</td>
            <td>no visible error; session still works for this request</td></tr>
        </tbody>
      </table>
    </section>

-------------------------------------------------------------------------------
14. TESTING PLAN — checklist
-------------------------------------------------------------------------------
What it's for: coverage the reviewer can skim and trust — golden path, every
error path above, and the regression surface. Native checkboxes are fine here
(markdown can't do this at all, which is exactly why this is an HTML artifact).

    <section id="testing-plan">
      <h2>Testing plan</h2>
      <ul class="checklist">
        <li><label><input type="checkbox"> Golden path: upload a 10MB file,
          confirm it appears in the dashboard within 5s</label></li>
        <li><label><input type="checkbox"> Error path: upload exceeds size
          limit -&gt; inline error, no partial row created</label></li>
        <li><label><input type="checkbox"> Error path: KV write failure ->
          request still succeeds via memory fallback</label></li>
        <li><label><input type="checkbox"> Regression: existing signed-URL
          download flow still works</label></li>
      </ul>
    </section>

-------------------------------------------------------------------------------
15. OPEN QUESTIONS
-------------------------------------------------------------------------------
What it's for: things you genuinely don't have a shortlist for yet — not
decision-card-ready. Plain list; these are discussion points, not click
targets.

    <section id="open-questions">
      <h2>Open questions</h2>
      <ul>
        <li>Do we need per-region KV replication for latency, or is eventual
          consistency fine for session reads?</li>
        <li>Should session TTL be configurable per user role?</li>
      </ul>
    </section>

-------------------------------------------------------------------------------
16. AI ADDENDUM — required when the plan touches prompts, models, or agents
-------------------------------------------------------------------------------
Skip this section entirely for ordinary deterministic work. Include it when
the plan proposes a prompt, a model call, a chain, retrieval, or an agent —
read `brain playbook ai` first, then add the following to the sections above:
two new sections, a gate folded into section 14, and (for multi-agent work) a
topology table. They exist because a plan for AI work that omits them is a
plan whose success cannot be judged.

- **Prompt contract** (place it right after section 9). For each prompt the
  plan introduces or changes: job in one sentence, inputs with realistic
  sizes, output shape the caller parses, known failure modes, and the model +
  settings pin. A reviewer should be able to tell what the prompt is
  responsible for without reading it.

- **Eval plan + golden set** (right after the prompt contract). Which suite
  measures this, how many cases and where they come from (real / synthetic /
  regression), the four coverage bands (typical, edge, adversarial,
  refusal-correct), the held-out slice, and which eval kind scores it
  (deterministic assertions / rubric + judge / human). State the baseline
  number if a suite already exists, or say plainly that building the suite is
  step one.

- **Regression gate** (fold into section 14's testing plan). What must never
  regress (the frozen cases), what tolerance the aggregate gets, and what
  makes you revert the change. "The number goes up" is not a gate.

- **Agent topology** (right before section 10's plan of record, if the work is
  multi-agent). A table of roles: name, model, tools, what it owns, its
  handoff contract, and its escalation rule. One row per role, and every
  phase in section 10 names the role that owns it.

Two decision cards worth adding by default when this addendum applies, since
both are shortlist questions a reviewer can click through in seconds:

- **Model choice** — the pin, with the cost/latency/quality tradeoff spelled
  out per option. Never leave this implicit; it silently sets the quality
  ceiling and the bill.
- **Eval kind** — deterministic assertions vs rubric + judge vs human sample,
  with what each one can and cannot see for THIS task.

Cost and latency belong in the plan too, in whatever section fits: a plan that
improves quality 5% at triple the cost per call is a tradeoff the human should
get to weigh, not a detail discovered after it ships.

-------------------------------------------------------------------------------
MERMAID GUIDANCE
-------------------------------------------------------------------------------
Preferred approach — Mermaid via CDN, degrades to readable text offline:

    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral" });
    </script>

    <pre class="mermaid">
    flowchart TD
      Browser -->|cookie| Worker
      Worker -->|read/write session| KV[(Cloudflare KV)]
      Worker --> D1[(D1: users)]
    </pre>

Center rendered diagrams (include in the shared style block):

    pre.mermaid { text-align: center; }
    pre.mermaid svg { display: block; margin: 0 auto; }

LAYOUT RULE — prefer VERTICAL diagrams (flowchart TD, top-down). A document
scrolls vertically: a TD flowchart keeps every node at readable size and easy
to click-annotate, while an LR (left-right) chart compresses horizontally at
document width until nodes are tiny. Use LR only when the flow is genuinely
short (<= 4 nodes) and reads better as a pipeline. sequenceDiagram is already
vertical. In the brain review UI, reviewers can click individual diagram nodes
to annotate them and zoom any diagram into a pan/zoom lightbox — bigger nodes
make both easier.

Why this is safe offline: a <pre> block renders as plain monospace text before
any script runs. If the CDN import fails (no network), the reviewer still sees
readable flowchart source instead of a broken widget or blank space — the
diagram degrades to text, it never disappears.

Use flowchart for the big picture (section 5) and sequenceDiagram for the
golden path (section 12):

    <pre class="mermaid">
    sequenceDiagram
      participant B as Browser
      participant W as Worker
      participant KV as Cloudflare KV
      B->>W: GET /dashboard (cookie: sid)
      W->>KV: get(sid)
      KV-->>W: session JSON
      W-->>B: 200 rendered dashboard
    </pre>

Alternative — hand-rolled inline SVG, for guaranteed offline rendering with no
network dependency at all (use this if the reviewer's environment might be
fully air-gapped, or you want zero risk of a CDN hiccup):

    <svg class="arch-diagram" viewBox="0 0 640 120" role="img"
      aria-label="Client to API to Database">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5"
          markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="currentColor"></path>
        </marker>
      </defs>
      <rect x="10" y="30" width="140" height="60" rx="8" class="box"></rect>
      <text x="80" y="65" text-anchor="middle" class="box-label">Client</text>
      <line x1="150" y1="60" x2="245" y2="60" class="arrow"></line>
      <rect x="250" y="30" width="140" height="60" rx="8" class="box"></rect>
      <text x="320" y="65" text-anchor="middle" class="box-label">API</text>
      <line x1="390" y1="60" x2="485" y2="60" class="arrow"></line>
      <rect x="490" y="30" width="140" height="60" rx="8" class="box"></rect>
      <text x="560" y="65" text-anchor="middle" class="box-label">Database</text>
    </svg>

-------------------------------------------------------------------------------
OTHER MARKDOWN-IMPOSSIBLE COMPONENTS WORTH USING
-------------------------------------------------------------------------------

- Checklist with native checkboxes — shown above in the testing plan. Also
  useful anywhere you want "is this actually done" to be a clickable state
  instead of prose.

- <details>/<summary> for depth layering — shown above in the plan of record.
  Use it for "why not X" asides, background a skimming reviewer can skip, or
  a deep-dive that would otherwise bloat the main flow. Keeps the default view
  short while the detail is one click away.

- Severity / status chips — the chip-* classes from section 0:

    <span class="chip chip-high">high risk</span>
    <span class="chip chip-status-draft">draft</span>

  Drop these next to any table row or heading where a reviewer benefits from
  a fast visual read (risk level, doneness, blocking/non-blocking).

- Approve / request-changes button pair — a simple verdict, queued the same
  way as a decision card, with its own fixed queueKey so repeated clicks
  replace rather than stack:

    <div>
      <button type="button" class="btn-approve" data-brain-action
        onclick="queueVerdict('approve')">Approve plan</button>
      <button type="button" class="btn-request-changes" data-brain-action
        onclick="queueVerdict('request-changes')">Request changes</button>
    </div>

    <script>
      function queueVerdict(verdict) {
        if (!(window.brain && typeof window.brain.queuePrompt === "function")) return;
        window.brain.queuePrompt({
          tag: "message",
          queueKey: "verdict",
          prompt: verdict === "approve"
            ? "Plan approved as written."
            : "Requesting changes — see annotations."
        });
      }
    </script>

-------------------------------------------------------------------------------
AUTHORING RULES
-------------------------------------------------------------------------------

- Single self-contained file. No separate CSS/JS files, no build step — the
  file must render correctly opened directly by double-clicking it.
- Inline CSS in one <style> block (section 0). System stacks only (serif for
  headings, sans for body), not a webfont — it must render identically with
  zero network access.
- Editorial, readability-first styling (section 0's palette and type rules):
  warm vellum background, ink body text, serif headings (weight 400-600,
  hierarchy from size, not boldness), 16px/1.6 body copy at a ~72ch reading
  measure centered on the page, white bordered-radius cards for decision
  cards and tables, hairline dividers everywhere, one terra-cotta accent used
  sparingly for "(recommended)" markers and small emphasis only. No saturated
  colors, no gradients, no decorative imagery, no heavy shadows — this is a
  document meant to be read start to finish and annotated, not a dashboard.
- Generous whitespace. Wide margins, tall line-height, real section breaks —
  this is read on a screen next to a sidebar, not printed.
- Every decision must be answerable by clicking only — no decision card
  should require the reviewer to type a sentence to move the plan forward.
  Free-text annotation (element clicks, text selection, the composer) is
  still available for anything you didn't anticipate; decision cards are for
  the questions you already know how to phrase as a shortlist. Never embed a
  fill-in text input next to an open question — annotating the question's
  own text is the answer path.
- Put data-brain-action on every custom interactive control (radio inputs,
  buttons, anything with an onclick) — otherwise annotate mode's click
  interception (see the SDK's shouldSkip check) will swallow the click as an
  element annotation instead of letting your handler run.
- Prefer window.brain.queuePrompt over hoping the reviewer types the right
  thing. If you can enumerate the options, make it a decision card.
