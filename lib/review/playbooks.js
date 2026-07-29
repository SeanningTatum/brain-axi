// lib/review/playbooks.js — authoring standards for agent-produced review
// artifacts, printed verbatim by `brain playbook <id>` (bin/brain.js).
//
// Zero runtime deps, pure data module. Each playbook is markdown content an
// agent reads and follows step by step while writing a file. Keep content
// free of literal backtick characters and `${` sequences — this file's
// values are plain JS template literals and must remain syntactically inert.
//
// See docs/REVIEW-ARCHITECTURE.md ("A4. Playbook command", "A5. The plan
// artifact standard") for the binding contract this module implements.

export const PLAYBOOKS = {
  start: {
    id: "start",
    use_when: "starting any non-trivial task — frame it, read the brain, baseline, open state",
    content: `TASK KICKOFF PLAYBOOK
=====================

You are about to start a non-trivial task in a repo with a \`.brain/\` harness.
This is the bookend that opens state before you touch anything — read what
the brain already knows, frame what you're about to do, and open the state
that lets the next session (or the next poll of this one) pick up where you
left off. Follow the seven steps below in order; do not start editing before
step 7's readiness statement.

Two principles carry over from the execution loop (\`brain playbook execute\`)
because they govern reading state exactly the way that one governs writing
it:

- **Two-layer state.** \`runs/progress.md\` is the rolling CURSOR — read it
  first for where the last session left off. \`features/<slug>/runs/<name>.md\`
  is DEEP state — read it when you're picking up a feature already in flight,
  not just the cursor's one-line summary of it.
- **Retrieval over recall.** Every step below is a real command, not a memory
  of what this repo tends to look like. Training data does not reflect this
  repo's actual state — the brain does.

-------------------------------------------------------------------------------
1. READ BRAIN STATE
-------------------------------------------------------------------------------

Reorient before acting — three commands, in this order:

- \`brain\` (bare, no subcommand) — the home dashboard: feature counts, the
  current in-progress feature (if any), the last checkpoint, any open review
  sessions.
- \`brain features\` — the full status tracker, one row per feature.
- \`brain progress\` — the latest checkpoint in full: branch, what happened, and
  what the last session said to do next.

Do not skip this because the task "sounds simple." A few seconds reading
three commands is cheap; building on a stale assumption about feature state
or what the last session actually finished is not.

-------------------------------------------------------------------------------
2. FRAME THE TASK
-------------------------------------------------------------------------------

Answer these three, in one sentence each:

- **Intent** — what is actually being asked, not the literal wording.
- **Scope** — one of: code / brain / both.
- **Affected feature slug(s)** — cross-check against the \`brain features\`
  output from step 1, or "none" if this task doesn't touch tracked feature
  work.

If you cannot answer all three confidently, ask ONE clarifying question and
stop. Do not guess at intent or scope and proceed anyway — a wrong guess here
compounds through every later step.

-------------------------------------------------------------------------------
3. READ THE RELEVANT DOCS
-------------------------------------------------------------------------------

For whatever layer you named in step 2's scope:

- \`brain docs <section>\` — list the docs in a section (\`rules\`, \`recipes\`,
  \`codebase\`, \`high-level-architecture\`, ...); \`brain docs view
  <section>/<name>\` (add \`--full\` for the complete body) to read one.
- \`brain search "<query>"\` (optionally \`--section <section>\`) — find text
  anywhere in the brain when you don't know which doc has it.

Do not rely on training data for this project's own patterns and
conventions — the brain's rules/codebase docs are the source of truth for
"how this repo actually does it," and they can (and do) diverge from what a
generic project of this shape would look like.

**If this task touches prompts, models, or agents**, read
\`brain playbook ai\` now as well, and run \`brain evals\` — the suites, their
case counts, their last score, and whether any is stale or regressed — the
same way you just read the feature tracker. A prompt change made without knowing which
suite measures it — and what that suite last scored — is the AI equivalent of
editing code with the tests hidden.

-------------------------------------------------------------------------------
4. SCOPE POLICY CHECK
-------------------------------------------------------------------------------

\`brain check\` — run it and look at the one-in-progress-at-a-time row along
with everything else. If it's failing because another feature is already
in-progress and you're about to claim one, resolve that FIRST:

    brain features set-status <other-slug> --status blocked   # or shipped / cut

Only claim a new feature once the policy check is clean. Every other failing
check row is also worth fixing before you add to the pile, not just the
in-progress one.

-------------------------------------------------------------------------------
5. ESTABLISH BASELINE
-------------------------------------------------------------------------------

    brain verify --stage baseline

MUST pass before you make a single edit. This is what lets you tell your own
changes apart from something that was already broken: a pre-existing failure
here gets NOTED, not silently folded into your diff as if you caused it or
fixed it.

Fresh clone (verify.json checks never ran here before)? Run
\`brain verify --stage bootstrap\` first — it's the one-time setup stage
(installs, migrations, whatever the project's own checks need before
\`baseline\`/\`verify\` can run at all).

AI work needs a SECOND baseline: \`brain evals run <suite>\` for the suite that
measures the prompt you are about to touch, before you edit anything.
Same logic as above — without a pre-change score, "it seems better now" is
unfalsifiable, and a pre-existing failure gets silently folded into your diff.
See \`brain playbook ai\` section 5.

-------------------------------------------------------------------------------
6. CLAIM + OPEN STATE
-------------------------------------------------------------------------------

- Working a tracked feature: \`brain features set-status <slug> --status
  in-progress\` — claims it, enforcing the one-in-progress policy from step 4.
- Always: \`brain progress add --summary "<what you're starting>"\` — opens the
  rolling cursor entry for this session.
- As you work: per-step evidence goes to \`brain runs append <slug> --step
  "..." --observed "..."\` — that loop belongs to the execution playbook
  (\`brain playbook execute\`), not this one; this playbook's job ends once
  state is open, that one's begins.

-------------------------------------------------------------------------------
7. READINESS STATEMENT
-------------------------------------------------------------------------------

Before writing a line of code, state one line:

    Task: <intent from step 2> · Feature(s): <slug(s) or none> ·
    Baseline: <exit code / result from step 5>

Only after this line — and no user redirect in response to it — start
working.

-------------------------------------------------------------------------------
DEFINITION OF READY
-------------------------------------------------------------------------------

- [ ] Brain state read (home, features, progress) — not skimmed from memory
- [ ] Task framed: intent, scope, affected feature(s) — or a clarifying
      question was asked instead
- [ ] Relevant docs read via \`brain docs\` / \`brain search\`
- [ ] \`brain check\` clean on the one-in-progress policy (and ideally
      everything else)
- [ ] Baseline established (\`brain verify --stage baseline\`, or \`bootstrap\`
      first on a fresh clone) — pass/fail recorded, not assumed
- [ ] Feature claimed (\`features set-status ... in-progress\`) if applicable
- [ ] \`progress add\` checkpoint opened
- [ ] Readiness statement said

Anything unchecked means you are not ready to start — go back and do that
step, don't skip straight to editing.
`,
  },

  plan: {
    id: "plan",
    use_when: "writing any plan/proposal/design artifact for human review",
    content: `PLAN ARTIFACT PLAYBOOK
=======================

You are about to write a plan/proposal/design as ONE standalone HTML file that a
human will review inside "brain review" (an iframe'd artifact + sidebar showing
brain memory: prior plans, timeline, screenshots, feature state). This is not a
markdown doc and not a chat message — it is a small web page. Read this whole
playbook before writing anything, then follow the 12-section structure in order.
If the plan touches prompts, models, or agents, section 13 (AI addendum) is
required on top of those twelve — read \`brain playbook ai\` before writing it.

Why this matters: a reviewer should be able to grasp what's going on, what needs
deciding, and the big picture, WITHOUT reading code — and every decision you need
from them should be answerable by clicking, not by typing an essay.

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
for, and where the review stands right now (draft / in-review / reviewed,
which round). Pull the status/round values from "brain plans view <slug>" if
this plan already exists, otherwise start at draft, round 0.

    <header>
      <h1>Auth session refactor</h1>
      <div>
        <span>2026-07-14</span> ·
        <span>feature: auth-sessions</span> ·
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
3. CONTEXT — cite brain memory
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
4. BIG PICTURE — one architecture diagram
-------------------------------------------------------------------------------
What it's for: components + data flow at a glance, not class trivia. One
diagram. See the "MERMAID GUIDANCE" section below for the flowchart snippet
and the offline-safe inline-SVG alternative. Use a flowchart here (top-down or
left-right); save sequence diagrams for the golden path section.

-------------------------------------------------------------------------------
5. DECISIONS NEEDED — numbered decision cards
-------------------------------------------------------------------------------
What it's for: this is the section that actually needs the human. Every open
question that has a shortlist of options becomes a decision card: 1-2
sentences of context, a radio group, a tradeoff table, one option pre-checked
and labeled "(recommended)", and a "Queue answer" button. The reviewer answers
by clicking — never by typing a paragraph. Questions that don't yet have a
shortlist go in section 12 (Open questions) instead.

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
6. INTERACTIVE REVIEW COMPONENTS
-------------------------------------------------------------------------------
What it's for: decision cards (section 5) cover shortlist-of-options questions.
This section covers the rest of what a plan needs to be truly clickable: lists
that the reviewer edits in place (add/remove/rewrite an item without typing a
prompt), the submit discipline that keeps those edits from spamming duplicate
prompts, and a lavish-axi input pattern worth porting. Read
lavish-axi's own "input" playbook for the underlying philosophy if you have
access to it; this section adapts that philosophy to the window.brain API and
the list-edit prompt tag.

--- 6.1 EDITABLE LIST COMPONENT (the flagship pattern) ---

Four sections in this playbook are fundamentally editable lists: Plan of
record (7), Error paths (10, a table), Testing plan (11), and Open questions
(12). Instead of leaving them as static markup the reviewer can only
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
            queueList(section, key, "Remove from " + section + ": \\"" + text + "\\"", "remove", text, index);
          } else {
            // Restore/cancel idiom — see prose below for why this is action
            // "edit", not a delete-the-queued-item call (no such API exists).
            queueList(section, key, "Cancelled: keep \\"" + text + "\\" in " + section, "edit", text, index);
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
              "Edit " + section + " item " + index + ": \\"" + text + "\\"", "edit", text, index);
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
          var list = document.querySelector("[data-brain-section=\\"" + section + "\\"]");
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
            "Add to " + section + ": \\"" + text + "\\"", "add", text, null);
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

Applied to Open questions (12) — the simplest case, a plain <ul>:

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

--- 6.2 THE RESTORE/CANCEL IDIOM (a design decision, stated explicitly) ---

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

--- 6.3 PER-QUESTION SUBMIT DISCIPLINE (adapted from lavish's input playbook) ---

This is the rule decision cards (section 5) and the list component above both
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
  text, the item-badge, the pill in the composer) — section 5's queue-ack
  span and this section's item-badge both exist for this reason.

--- 6.4 OTHER LAVISH INPUT PATTERNS — one worth porting, one deliberately not ---

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
  "decision" — not needed; section 5 already covers the exact same shape
  (radio group + tradeoff table + one queued choice) and inventing a second
  tag for the same data would just be two names for one thing.

-------------------------------------------------------------------------------
7. PLAN OF RECORD — phased steps with acceptance criteria
-------------------------------------------------------------------------------
What it's for: what you're actually going to do, in order, and how you'll know
each phase is done. Not a task list — acceptance criteria, so "done" is
checkable.

    <section id="plan-of-record">
      <h2>Plan of record</h2>
      <ol>
        <li><strong>Phase 1 — introduce a KV-backed SessionStore.</strong>
          Acceptance: SessionStore implemented for KV; unit tests pass against
          a local KV simulator.</li>
        <li><strong>Phase 2 — cut over reads, dual-write.</strong>
          Acceptance: reads prefer KV with a fallback to memory; writes go to
          both; zero session-loss errors in staging for 24h.</li>
        <li><strong>Phase 3 — remove the in-memory path.</strong>
          Acceptance: in-memory store deleted; all tests green; one week in
          prod with no regression in session-related error rate.
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
8. FILES THAT CHANGE
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
9. GOLDEN PATH — the happy-path walkthrough end to end
-------------------------------------------------------------------------------
What it's for: how a normal request actually flows through the new design,
step by step. A sequence diagram is the natural fit here — see MERMAID
GUIDANCE below for the snippet and the "sequenceDiagram" recommendation.

-------------------------------------------------------------------------------
10. ERROR PATHS
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
11. TESTING PLAN — checklist
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
12. OPEN QUESTIONS
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
13. AI ADDENDUM — required when the plan touches prompts, models, or agents
-------------------------------------------------------------------------------
Skip this section entirely for ordinary deterministic work. Include it when
the plan proposes a prompt, a model call, a chain, retrieval, or an agent —
read \`brain playbook ai\` first, then add the following to the twelve above:
two new sections, a gate folded into section 11, and (for multi-agent work) a
topology table. They exist because a plan for AI work that omits them is a
plan whose success cannot be judged.

- **Prompt contract** (place it right after section 6). For each prompt the
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

- **Regression gate** (fold into section 11's testing plan). What must never
  regress (the frozen cases), what tolerance the aggregate gets, and what
  makes you revert the change. "The number goes up" is not a gate.

- **Agent topology** (right before section 7's plan of record, if the work is
  multi-agent). A table of roles: name, model, tools, what it owns, its
  handoff contract, and its escalation rule. One row per role, and every
  phase in section 7 names the role that owns it.

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

Use flowchart for the big picture (section 4) and sequenceDiagram for the
golden path (section 9):

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
`,
  },

  ai: {
    id: "ai",
    use_when: "any work involving prompts, models, or agents — evals, golden sets, regression gates, topology",
    content: `AI WORK PLAYBOOK
=================

You are about to plan, build, or change something whose output comes from a
model rather than from deterministic code. Everything the rest of this harness
assumes — a check that passes or fails, a diff that means what it says — stops
holding here. A prompt edit is a change with no compiler, no type error, and no
test that fails when you make it worse. This playbook is how that work becomes
checkable anyway.

One sentence to carry through all of it: **the eval set is the test suite, the
golden set is the spec, and a failing case is not a bug report — it is a new
golden case.**

-------------------------------------------------------------------------------
0. WHEN THIS APPLIES
-------------------------------------------------------------------------------

Apply this playbook when the work involves any of:

- a prompt (system, user, or template) whose text you are writing or editing;
- a model call whose output feeds a product surface, a decision, or another
  model;
- an agent, tool loop, or chain of model calls;
- retrieval or context assembly feeding any of the above.

Do NOT apply it to code that merely sits near AI features (a route that
forwards a request, a schema, a button). Deterministic code gets the ordinary
loop: \`brain playbook start\` / \`execute\` / \`done\`. This playbook is additive
to those, never a replacement for them.

If you are unsure: does a rerun with identical inputs produce a materially
different output? If yes, you are in this playbook.

-------------------------------------------------------------------------------
1. THE PROMPT CONTRACT — write it before you write the prompt
-------------------------------------------------------------------------------

Every prompt in the repo is an artifact with a contract, not a string literal
somewhere in a service file. Before editing or authoring one, write down (in
the plan, the feature doc, or a header comment beside the prompt itself):

- **Job** — one sentence. What this single prompt is responsible for. If you
  need two sentences joined by "and," you probably want two prompts (see
  section 6).
- **Inputs** — every variable interpolated in, with its source and its
  realistic size. "transcript (user upload, 2k-40k tokens)" — not "text".
- **Output shape** — the exact structure the caller parses. JSON schema, an
  enum, a fenced block, a single word. If a downstream parser exists, its
  expectations ARE the contract.
- **Failure modes you already know about** — refusal, truncation, invented
  facts, wrong language, over-length, schema drift. These become eval cases in
  section 3, one per line.
- **Model + settings pin** — model id, temperature, max tokens, tools
  available. **A prompt evaluated on one model is not evaluated on another.**
  Model changes are prompt changes: re-run the suite.
- **Owner** — the feature slug this prompt belongs to.

Storage rule for this harness: prompts live in the app repo next to the code
that sends them (one prompt per file, versioned by git). The brain holds a
pointer, the golden set, and the run history — never a divergent copy of the
prompt text.

-------------------------------------------------------------------------------
2. PROMPTING PRACTICE — the parts that actually move numbers
-------------------------------------------------------------------------------

Not a style guide. These are the moves that repeatedly show up as measurable
differences in eval scores; each one is a hypothesis you then TEST (section 4),
not a rule you apply on faith.

- **Be explicit about the task, the audience, and the output format.** Most
  bad outputs are answers to a question you didn't realize you asked
  ambiguously. State what "good" looks like in the prompt itself.
- **Show, don't adjectivize.** "Concise, professional tone" is weaker than two
  short examples of the exact register you want. Examples are the highest
  leverage tokens in most prompts — 2 to 5 diverse ones, covering the edges
  you care about, not five variations of the easy case.
- **Structure long prompts with delimiters** (XML-ish tags, markdown headers,
  clearly labeled sections). Put long context (documents, transcripts) EARLY
  and the instruction LAST — a model that read the instruction 30k tokens ago
  follows it less reliably than one that just read it.
- **Ask for the output shape you will parse**, and make the shape easy to
  produce: a fenced JSON block beats prose-with-JSON-inside; a single enum
  token beats a sentence you regex. Validate on the way out (section 6) —
  never trust format compliance.
- **Give the model room to think when the task needs it** (reason first, then
  answer in the required shape), and take it away when it doesn't (a
  classification that gets worse with rambling). Which one is true here is an
  eval question, not a preference.
- **Prefer positive instruction to prohibition.** "Answer only from the
  provided document; if it is not there, say NOT_FOUND" beats "don't make
  things up."
- **Say what to do when the input is bad.** Empty, adversarial, off-topic,
  wrong language, too long. Undefined behavior in a prompt shows up as
  confident nonsense in production.
- **Change ONE thing at a time and re-run.** A prompt rewrite bundling six
  changes tells you nothing about which one helped, and it usually hides one
  that hurt.
- **Delete as often as you add.** Prompts accrete; long prompts dilute. If a
  clause cannot be traced to a case it fixed, try removing it and re-running —
  if the score holds, it was decoration.

-------------------------------------------------------------------------------
3. THE GOLDEN SET — the spec, written as cases
-------------------------------------------------------------------------------

Before optimizing anything, build the set you will measure against. It lives
in the brain (\`.brain/evals/<suite>/cases.jsonl\`, one JSON object per line)
because it is project state that outlives any single session.

Read what already exists first: \`brain evals\` for the suite index,
\`brain evals view <suite>\` for thresholds and coverage,
\`brain evals cases <suite>\` for the set itself.

Construction rules:

- **Minimum ~20 cases before you trust a delta at all**, and expect the number
  to grow forever. Below that, run-to-run noise is larger than most real
  improvements and you will chase ghosts.
- **Source from reality first.** Real user inputs, real failures, real support
  complaints, real logs. Synthetic cases are a bootstrap, not a destination
  (section 3b).
- **Cover four bands deliberately**, not just the happy path: typical, edge
  (empty / huge / malformed / multilingual), adversarial (injection, jailbreak,
  contradictory instructions), and refusal-correct (cases where the right
  answer is to decline or say "not in the document").
- **Every case records its origin** — \`real\`, \`synthetic\`, or \`regression\`,
  plus a one-line note on why it exists. A case whose purpose nobody remembers
  gets deleted in six months, usually right before it would have caught
  something.
- **Every bug you fix becomes a frozen regression case, in the same session
  you fix it.** \`frozen: true\` means: this case may never regress, at any
  aggregate score. This is the single highest-value habit in this playbook —
  it is how an AI feature stops re-breaking the same way.
- **Hold out a slice you never tune against** (roughly 20%). If you edit the
  prompt in response to a case, that case is training data now. A score that
  only ever goes up on cases you optimized against is measuring your memory,
  not the system.
- **Expected values are assertions, not transcripts,** for any free-form
  output. "Mentions the refund window; does not invent a policy number; under
  120 words" is checkable and stable; a pinned paragraph of prose is neither.

--- 3b. SYNTHESIZING CASES (when you have no real data yet) ---

Legitimate, and often the only way to start — with guardrails:

- Enumerate the AXES first (input length, tone, language, domain, user intent,
  malformed-ness), then generate ACROSS them. Ungrounded bulk generation
  produces fifty rewordings of the same easy case and a flattering score.
- Mark them \`origin: synthetic\`. When real cases arrive, real ones win any
  conflict, and the synthetic share should shrink over time.
- **Have a human read them before they are frozen.** A synthetic case with a
  wrong expected answer is worse than no case: it teaches the prompt to be
  wrong and it does it silently.
- Do not generate cases with the same model+prompt you are evaluating, then
  grade with it too. That measures self-consistency, not quality.

-------------------------------------------------------------------------------
4. EVAL DESIGN — pick the cheapest thing that discriminates
-------------------------------------------------------------------------------

Three kinds, in ascending order of cost and descending order of reliability.
Use the cheapest one that actually separates good output from bad:

1. **Deterministic assertions** — schema validity, required substring, regex,
   numeric range, length cap, "parses as JSON", exact match on a classification
   label. Fast, free, reproducible. Most quality bars decompose into more of
   these than people expect. Start here.
2. **Rubric + LLM judge** — for free-form quality (helpfulness, tone,
   faithfulness to a source). Write the rubric as explicit criteria with a
   small scale (0-2 or 0-3, not 1-10 — models do not have ten calibrated
   levels), and demand a short rationale before the score.
3. **Human** — for the things a judge cannot see yet: taste, brand voice, "is
   this actually useful." Expensive, so spend it on a sample and on
   calibration, not on every run.

Rules that apply to all three:

- **Sanity-check the metric before you trust it: deliberately degrade the
  prompt and confirm the score drops.** A metric that does not move when
  quality moves is worse than no metric — it launders bad changes as safe.
- **Judge calibration is a recommendation, not a gate — but do it early.**
  Label a slice by hand, compare against the judge, and write down the
  agreement rate. "The judge agrees with me on 84% of cases" makes every later
  score interpretable; an uncalibrated judge score is a number with no units.
  Judge with a different model (or at minimum a different prompt) than the one
  under test.
- **Control nondeterminism.** Temperature 0 where the task allows it; where it
  does not, run each case N times and report pass rate, not a single sample.
  A "regression" that is one unlucky sample wastes a session; a real
  regression hidden by one lucky sample ships.
- **Record cost and latency alongside quality.** A prompt that scores 2 points
  higher and costs 3x is a decision, not an improvement — surface it as one.

-------------------------------------------------------------------------------
5. THE LOOP — how a prompt change actually gets made
-------------------------------------------------------------------------------

1. **Baseline.** \`brain evals run <suite>\` BEFORE touching anything. Same rule
   as \`brain verify --stage baseline\` for code: without a baseline you cannot
   tell your change apart from what was already broken. \`brain evals\` lists
   every suite with its last score and state (never-run / stale / regressed).
2. **Change one thing.** One hypothesis, stated: "adding two refusal examples
   should fix the four hallucinated-policy cases."
3. **Re-run the suite** — \`brain evals run <suite>\` again. It prints the
   per-case failures and the delta, not just an average: a change that fixes
   four cases and breaks two is a wash the aggregate would hide.
4. **Frozen cases are checked separately, and they are absolute.** Any frozen
   regression case that flips to failing kills the change outright, whatever
   the aggregate did — that is what \`gate: fail\` means in the run output.
5. **Record it as a run step** — \`brain runs append <slug> --step "prompt: +2
   refusal examples" --observed "<the real before/after numbers>"\`. Verbatim
   output, never a remembered summary.
6. **New failures become new cases** before you move on, not "later":
   \`brain evals golden add <suite> --id <id> --input "..." --expected "..."
   --frozen\`, or \`brain evals golden freeze <suite> <case-id>\` when the case
   already exists.
7. **Checkpoint with the delta** — \`brain progress add --eval <suite>
   --summary "..." --next "..."\`. The flag reads the score, delta, frozen
   failures and cost out of the suite's own run record, so the number in the
   checkpoint is one that was actually measured rather than one you
   remembered. A checkpoint on AI work with no number says nothing.
8. **Loop.** Stop when the hypothesis list is empty, not when the number is
   pretty.

Running a suite elsewhere (promptfoo, a python harness, an agent-scored pass)?
Record it instead of re-running: \`brain evals record <suite> --from <file>
--adapter promptfoo\`. The gate, the run history, and the checkpoint stamp all
work identically — brain reads the file your tool already wrote, and never
calls a model itself.

The gate runs as \`brain verify --stage evals\` (every suite, exit 1 on any
failure). It is opt-in and deliberately NOT part of an ordinary
\`brain verify\` — model calls cost money, and a gate that makes every
checkpoint expensive is a gate someone will quietly remove.

Gate discipline, in one line: **frozen cases are absolute; aggregate scores
get a tolerance band.** Fuzzy metrics flap, and a gate that flaps gets
disabled — which is the actual failure mode to design against.

Prompts are re-evaluated on: prompt text change, model or settings change,
retrieval/context-assembly change, tool definition change, and dependency
upgrades that touch any of those. **Nothing on that list is "just a config
change."**

-------------------------------------------------------------------------------
6. PIPELINES, GUARDRAILS, AND WHEN TO REACH FOR AN AGENT
-------------------------------------------------------------------------------

Decompose downward — take the least dynamic thing that does the job:

- **Deterministic code** whenever the step is expressible as code. Do not ask
  a model to sort, count, join, or validate what a function can do exactly.
- **A single prompt** when the task is one transformation with one output
  shape.
- **A prompt chain** when the task has genuinely distinct failure modes
  (extract, then judge, then write). Each stage gets its OWN eval — a chain
  evaluated only end-to-end tells you it broke, never where.
- **An agent (tool loop)** only when the path cannot be known in advance —
  the model must decide what to do next based on what it just learned. Agents
  trade determinism for adaptability; pay that price deliberately.
- **Multiple agents** only when subtasks are genuinely independent and each
  needs its own context. Coordination overhead is real and mostly invisible
  until it fails.

Guardrails every model call in a pipeline gets:

- **Validate the output shape and retry with a repair message** on failure —
  bounded retries, never unbounded.
- **Cap the loop** (max tool calls, max tokens, wall-clock timeout) and define
  what happens at the cap. Fail closed with a legible error; do not silently
  return a partial result as if it were complete.
- **Never interpolate untrusted text into an instruction position.** User
  content goes in a clearly delimited data section, with the standing rule
  that instructions inside it are data, not commands. Add prompt-injection
  cases to the golden set (section 3) — that is how you know the guardrail
  holds instead of hoping.
- **Log the inputs, outputs, and trace of every stage.** An AI bug you cannot
  reproduce from a trace is an AI bug you will fix by guessing.

-------------------------------------------------------------------------------
7. AGENT TOPOLOGY + COORDINATION
-------------------------------------------------------------------------------

When work is split across agents (sub-agents, a coordinator, or specialist
roles), write the topology down before running it — in the plan, and in the
feature doc for anything standing:

- **Role** — name, the model it runs on, the tools it may use, and the ONE
  thing it owns.
- **Handoff contract** — exactly what crosses the boundary in writing:
  objective, constraints, definition of done, and the return format. An agent
  that has to infer its objective from context will confidently do adjacent
  work you did not ask for.
- **Escalation rule** — what makes this role stop and hand back rather than
  improvise. Ambiguity, a failing gate, a destructive action, a decision the
  human owns.
- **Verification** — who checks the sub-agent's output, and against what. The
  parent VERIFIES, it does not trust: a returned "done" is a claim, and claims
  get checked against real command output like every other claim in this
  harness.

Two failure modes worth naming because they are common and expensive:
duplicated work across roles that were never given disjoint ownership, and a
coordinator that reports a sub-agent's summary upward without ever confirming
it. Both are cheap to prevent in the topology table and painful to find later.

-------------------------------------------------------------------------------
8. THE HUMAN LOOP — prompts and evals are reviewable artifacts
-------------------------------------------------------------------------------

Numbers do not tell you the output is any good; they tell you it changed. Put
the actual prompt and the actual outputs in front of the human:

- Surface the **prompt text** and a **sample of per-case outputs** (failures
  first) for review — the human reads what the model actually wrote, not a
  score summary of it.
- Their comments land as project state (a feedback note under the suite), and
  they feed BOTH the prompt (fix the instruction) and the golden set (encode
  the judgment as a case). Feedback that only edits the prompt is feedback you
  will need again.
- **Unreviewed feedback blocks "done."** If a human commented on eval output
  and nothing in the prompt or the golden set changed in response, the task is
  not finished — see \`brain playbook done\`.
- Re-review after material prompt changes. A prompt the human blessed three
  rewrites ago has not been reviewed.

-------------------------------------------------------------------------------
9. ANTI-PATTERNS — the ways this goes wrong
-------------------------------------------------------------------------------

- **Vibes-based iteration.** Trying three inputs by hand, liking the output,
  declaring it better. This is the default failure and everything above exists
  to replace it.
- **Tuning on the eval set** until the number is beautiful and the held-out
  slice is untouched. You optimized the measurement.
- **Judge = generator**, uncalibrated. The model grades its own homework and
  gives itself an A.
- **Chasing the aggregate** while frozen regression cases quietly rot.
- **Silent model drift** — an unpinned model version changes under you and
  nobody re-runs anything. Pin it; treat a bump as a prompt change.
- **Prompt edits with no re-run**, because "it was only a wording tweak."
  Wording tweaks are the entire mechanism by which prompts change behavior.
- **Golden set frozen in time** — no new cases in months means either nothing
  is failing (unlikely) or failures are not being encoded (certain).
- **Evals that never fail.** If the suite has been green for every run since
  it was written, it is too easy to be measuring anything.

-------------------------------------------------------------------------------
10. READINESS — before you start editing prompts
-------------------------------------------------------------------------------

State these, briefly, the same way \`brain playbook start\` demands a readiness
statement:

- Which prompt(s) this touches, and their contract (section 1).
- Which suite measures it, how many cases, and the baseline number you just
  read from a real run.
- Your ONE hypothesis for this change.
- What would make you revert it.

If you cannot state the baseline because no suite exists, then building the
suite IS the task — do that first, and say so. A prompt change with no way to
tell whether it helped is not work, it is a coin flip with extra steps.
`,
  },

  verify: {
    id: "verify",
    use_when: "verifying a user-visible feature works — browser walk with screenshot evidence",
    content: `FEATURE VERIFICATION PLAYBOOK
==============================

You are acting as a feature-verifier: proving, with a real browser walk and
screenshot evidence, that a user-visible feature actually works — golden
path plus at least one error path. This is not a unit test and not a code
read-through; if you did not drive the live app and capture a screenshot at
each asserted state, you have not verified anything.

Output of this playbook is ONE file: a verdict doc at
.brain/features/<slug>/verifications/<YYYY-MM-DD>.md, plus the screenshots
it references, persisted via the brain-axi CLI (commands below). Tool-agnostic
about the browser driver — Playwright is the recommended approach and the
pattern below assumes it, but any scriptable browser automation that can
screenshot and read console/network events works the same way.

-------------------------------------------------------------------------------
1. BEFORE YOU DRIVE THE BROWSER
-------------------------------------------------------------------------------

- Read the feature doc first: \`brain features view <slug>\`. Know what the
  golden path and error handling are SUPPOSED to be before you go looking.
- Confirm the app is reachable (start the dev server if it isn't already
  running — note in the doc whether you started it or it was already up).
- Pick ONE golden path (the primary happy-path flow) and ONE error path (a
  failure mode the feature must handle gracefully — bad input, unauthorized
  access, a validation rejection). Don't try to cover everything; one clean
  walk of each is the standard.
- Decide your screenshot naming up front (see NAMING below) so step numbers
  in the script match the step numbers in the doc's tables.

-------------------------------------------------------------------------------
2. NAMING CONVENTION — screenshots
-------------------------------------------------------------------------------

- Golden path steps: NN-<step>, zero-padded two digits, in order:
  01-signin.png, 02-dashboard.png, 03-....png
- Error path steps: E<N>-<step>, one per error scenario walked:
  E1-bad-login.png, E2-....png
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
      if (res.status() >= 400) networkErrors.push(\`\${res.status()}@\${currentStepLabel}\`);
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
slug, date, verdict, and the two step tables without reading prose):

    # Verification: <Feature Name>

    - **Slug**: \`<slug>\` (feature memo: \`.brain/features/<slug>/<slug>.md\`)
    - **Date**: YYYY-MM-DD
    - **Verified by**: <you / your agent name> (<driver>, e.g. "Playwright CLI — headless script")
    - **Base URL**: <url> _(dev server: started by agent | already running)_
    - **Role**: <the account/role state each path used>
    - **Verdict**: ✅ PASS | ❌ FAIL | ⛔ BLOCKED — _one line why_

    ## Golden path

    _What a user does for the happy case._

    | # | Step | Expected | Observed | Screenshot | Result |
    |---|------|----------|----------|------------|--------|
    | 01 | Sign in | Lands on /dashboard | ... | [\`01-signin.png\`](../screenshots/01-signin.png) | ✅ |

    ## Error path

    _One failure the feature must handle gracefully._

    | # | Step | Expected failure surface | Observed | Screenshot | Result |
    |---|------|--------------------------|----------|------------|--------|
    | E1 | Submit invalid input | Inline error, no crash | ... | [\`E1-error.png\`](../screenshots/E1-error.png) | ✅ |

    ## Console

    - **jsErrors** — quote verbatim, or "none". Any entry = FAIL (unless a
      documented environment artifact — show your grep evidence).
    - **networkErrors** — "<status>@<step>", quote, or "none". Expected on
      error-path steps; a FAIL only if it fired on a golden-path step.

    ## Findings for main thread

    Missing test hooks/selectors, bugs observed, anything the implementing
    agent should act on — or "none".

    ## Verdict rationale

    One paragraph: why PASS/FAIL/BLOCKED. If FAIL or BLOCKED, state the exact
    blocker, not a vague summary.

**Verdict** line values, exactly:
- ✅ PASS — both paths worked, no disqualifying jsError.
- ❌ FAIL — a golden-path step didn't work, or any real jsError fired.
- ⛔ BLOCKED — you could not complete the walk at all (app down, environment
  broken) — this is not the same as FAIL; say what blocked you.

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

Then write the verdict doc itself to
.brain/features/<slug>/verifications/<YYYY-MM-DD>.md (today's date). There is
no CLI write command for the doc body — write the file directly with your
file-editing tool, following the structure above.

Confirm it's discoverable:

    npx -y brain-axi verifications <slug>
    npx -y brain-axi verifications view <slug> <YYYY-MM-DD>

Both should show your new doc with the correct verdict parsed from the
**Verdict** line. If a checkpoint is warranted, follow up with
\`brain progress add --summary "..."\` noting the verification result.

-------------------------------------------------------------------------------
AUTHORING RULES
-------------------------------------------------------------------------------

- Golden path + at least one error path, always — a verification with only a
  happy path proves nothing about error handling.
- Every asserted state gets a screenshot. If you didn't screenshot it, you
  didn't verify it.
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
`,
  },

  execute: {
    id: "execute",
    use_when: "implementing an approved plan / working a feature to shipped",
    content: `EXECUTION LOOP PLAYBOOK
========================

You are implementing an approved plan or working a feature toward shipped.
This playbook is the loop that keeps that work checkable at every step
instead of becoming a single unverifiable claim at the end ("I built it and
it works"). Two rules underlie everything below:

- **Two-layer state.** \`runs/progress.md\` is a rolling CURSOR — one short
  checkpoint per session, just enough for the next session (or the next
  agent) to reorient. \`features/<slug>/runs/<name>.md\` is DEEP state — the
  verbatim step-by-step record of what you actually ran and observed. Do not
  put verbatim command output in progress.md, and do not rely on memory
  instead of writing it to the run note — if it is not written down, the
  next poll of this session (or a fresh session) cannot see it.
- **Evidence strings are sourced from real command output, never invented.**
  Every \`--observed\` value, every \`--evidence\` string, is something you
  actually ran and read back — a test runner's summary line, a screenshot
  diff, a verdict doc's own Verdict line. Writing what you expect to be true
  instead of what a command told you is exactly the failure mode this whole
  loop exists to prevent.

-------------------------------------------------------------------------------
THE LOOP
-------------------------------------------------------------------------------

1. **\`brain features set-status <slug> --status in-progress\`** — claim the
   feature. This enforces the one-in-progress policy: if another feature is
   already in-progress, flip it to shipped/blocked/cut first (or pick a
   different feature).

   Then open the dashboard for the human: **\`brain watch <slug>\`** (or pass
   \`--no-open\` and print its URL). It shows feature status, harness health,
   checkpoints, run-step logs, verification verdicts, screenshots, and PR
   state — live, as every command below writes state. The human watches
   execution there instead of asking you for progress reports.

2. **Per step, \`brain runs append <slug> --step "..." --observed "..."\`** —
   after each meaningful unit of work (ran the tests, drove a migration,
   fixed a bug, hit a dead end), append a step with the VERBATIM observed
   output. This is what makes \`features/<slug>/runs/<name>.md\` a real
   record instead of a summary you wrote from memory. Small, frequent steps
   beat one giant step at the end — if the session gets interrupted, the run
   note is what a fresh session reads to pick up exactly where you left off.

3. **On every visual test, pass AND fail —
   \`brain shots add <img> --feature <slug> --step NN-name\`** (or
   \`E1-name\` for an error-path capture). Screenshot the failure too, not
   just the success: a failing screenshot is often the single most useful
   artifact for whoever looks at this next, and "it failed, I didn't capture
   it" is not evidence of anything.
   How to capture: brain-axi ships no browser automation by design — scaffold
   a throwaway Playwright script yourself (project-pinned playwright if the
   repo has one, else \`npx -y playwright install chromium\` once; script in a
   gitignored project tmp/ path, never /tmp; delete it after). The verify
   playbook (\`npx -y brain-axi playbook verify\`) has the full script
   pattern — the same driver serves mid-execution captures and the final
   verification walk.

3b. **On every prompt or model change, \`brain evals run <suite>\` and record
   the per-case delta** — \`brain runs append <slug> --step "prompt: <the one
   change>" --observed "<real before/after numbers, including any frozen case
   that flipped>"\`. This is the AI analogue of step 2's rule, and it carries
   one extra clause: a frozen regression case that flips to failing kills the
   change outright, whatever the aggregate did. Aggregate-only reporting hides
   a change that fixed four cases and broke two. Full loop:
   \`brain playbook ai\` section 5.

4. **Once the feature is demonstrably working end to end, produce a
   verification doc.** Run \`npx -y brain-axi playbook verify\` and follow
   it: golden path + one error path, driven in a real browser, screenshots
   named to match, a Verdict line. This is the step that turns "I tested it"
   into something someone else can check without re-doing your work.

5. **\`brain ship <slug> --evidence "..."\`** — flip the feature to shipped.
   This single command, in order: requires non-empty \`--evidence\` (refuses
   otherwise); no-ops cleanly if already shipped; sets status shipped +
   evidence; warns (does not block) if the feature has zero screenshots;
   records a \`brain progress add\` checkpoint summarizing the ship; then
   runs \`brain check\` and reports any invariant failure honestly — the
   status change is NOT rolled back on a check failure, because the ship
   itself already happened; the check is telling you something else in the
   brain needs fixing, not that the feature didn't ship. Compose
   \`--evidence\` from what you actually observed (a verdict doc's verdict, a
   test run's summary line) — never a sentence you made up to satisfy the
   flag.

6. **Record the PR: \`brain pr <slug> --url <url>\`** — after \`gh pr create\`
   (or however the PR gets opened), record its URL. This flips the dashboard
   to its PR-opened terminal state and checkpoints it — the loop's visible
   endpoint: approval → execution → PR. Re-running overwrites (fine for a
   force-pushed replacement PR).

-------------------------------------------------------------------------------
ONGOING
-------------------------------------------------------------------------------

- **\`brain check\`** — run it any time you want a deterministic read on
  harness health (feature_list.json validity, the one-in-progress policy,
  every feature doc resolving, dependency refs, plan/review file integrity,
  verification docs having a Verdict line). Exit 1 on any failing check —
  usable as a CI gate, and worth running before you claim anything is done.
- If a review session is open for this feature's plan, the chrome sidebar's
  Execution section mirrors this same state (feature status + evidence,
  \`brain check\` health, latest checkpoints, verifications, screenshots)
  live as you work — you do not need to narrate progress in chat separately
  from what these commands already persist.
- If you are also polling that review session (\`brain review poll\`), each
  returned prompt carries \`line\` + \`text\` anchors resolved against the plan
  artifact's current content — apply edits via targeted reads/anchored
  replacements at that line, not a full re-read of the artifact.
- Every command above supports \`--help\`; every result carries a \`help:\`
  line pointing at the next command in this loop.
`,
  },

  done: {
    id: "done",
    use_when: "before declaring any task complete — full verify, harness invariants, coherence",
    content: `TERMINATION CHECK PLAYBOOK
==========================

You are about to declare a task complete. This is the bookend that closes the
state \`brain playbook start\` opened — full verify, harness invariants, and a
brain-coherence pass, before a single "looks done to me" claim leaves this
session. The rule this playbook exists to enforce, ported from the execution
loop (\`brain playbook execute\`): every claim below is something you actually
ran and read back, never something you expect to be true. A red row you
didn't look at is not a passed check — it's an unchecked one.

-------------------------------------------------------------------------------
1. FULL VERIFY
-------------------------------------------------------------------------------

    brain verify --feature <slug>

Runs every declared project check (the full \`verify\` stage — typecheck,
tests, lint, e2e, whatever \`.brain/verify.json\` registers). Every row must be
green. On a failure:

- Fix the underlying problem.
- Re-run just that check: \`brain verify --only <name>\`.
- Never declare the task done with a red row still showing — "it'll probably
  pass on the next run" is not a result.

Pass \`--feature <slug>\` (when this task is scoped to a tracked feature) so
the final green run is appended as a run-note step under that feature — real
verbatim output, not a paraphrase, landing as evidence for step 5.

-------------------------------------------------------------------------------
2. FEATURE VERIFICATION FOR USER-VISIBLE WORK
-------------------------------------------------------------------------------

If this task shipped or changed user-visible behavior, produce a
verification doc: golden path + one error path, driven in a real browser,
screenshots, a Verdict line. That full standard lives in
\`brain playbook verify\` — read and follow it there; this playbook does not
duplicate it. Confirm it landed with \`brain verifications <slug>\`.

Pure internal refactor / no user-visible surface changed? Skip this step —
but say so explicitly in your final report rather than silently omitting it.

-------------------------------------------------------------------------------
2b. AI WORK — EVAL GATE, GOLDEN CASES, HUMAN FEEDBACK
-------------------------------------------------------------------------------

Skip if this task touched no prompt, model, chain, retrieval, or agent. If it
did, run

    brain verify --stage evals

and hold all four of the following — read \`brain playbook ai\` for the
reasoning:

- **The suite was re-run after your LAST edit**, not three edits ago. Report
  the real before/after numbers, not "it improved." \`brain evals\` marks a
  suite \`stale\` when a prompt it points at changed after the last run.
- **No frozen regression case is failing.** These are absolute: a red frozen
  case blocks done regardless of how the aggregate moved, and the aggregate
  must be inside its tolerance band rather than merely "close."
- **Every bug you fixed this session exists as a new frozen case** in the
  golden set (\`brain evals golden add ... --frozen\`, or
  \`brain evals golden freeze <suite> <case-id>\`). Fixing a failure without
  encoding it means the next prompt rewrite is free to reintroduce it, and it
  will.
- **Human feedback on eval output has been answered.** If a human commented on
  prompts or eval results and nothing changed in the prompt OR the golden set
  in response, the loop is open and the task is not done. Answering means a
  concrete change or an explicit, written "not doing this, because —" — not
  silence.

No suite exists for the prompt you changed? Say that plainly in the final
report as a known gap. Do not report the change as verified.

-------------------------------------------------------------------------------
3. HARNESS INVARIANTS
-------------------------------------------------------------------------------

    brain check

Every row must pass — feature-list validity, the one-in-progress policy, doc
paths resolving, dependency refs, plan/review file integrity, verification
docs having a Verdict line. Exits 1 on any failure. Fix and re-run; do not
report done over a failing \`brain check\`.

-------------------------------------------------------------------------------
4. BRAIN COHERENCE
-------------------------------------------------------------------------------

For every path your diff touched, name the brain doc that owns it (a rules
doc, a codebase doc, the feature's own \`<slug>.md\`) and confirm it still
describes reality:

- Changed how something behaves or is structured? The owning rules/codebase
  doc should say so now, not what it said before you started.
- Changed a tracked feature's behavior? Its \`<slug>.md\` should reflect that
  change.

Flag, explicitly, any changed path whose owning doc you did NOT update — do
not let it pass silently as "probably fine."

-------------------------------------------------------------------------------
5. CLOSE STATE
-------------------------------------------------------------------------------

- Final step of record: \`brain runs append <slug> --step "..." --observed
  "..."\` — the last verbatim entry in this task's deep run-note record.
- Checkpoint: \`brain progress add --summary "<what shipped>" --next "<what's
  next, if anything>"\` — closes the rolling cursor for this session.
- Feature actually done, not just this task? \`brain ship <slug> --evidence
  "<from real output — a verify result, a verdict line>"\` — this single
  command flips status to shipped, checkpoints, and runs \`brain check\` itself,
  so parts of steps 3 and 5 above happen again as part of shipping. Never
  compose \`--evidence\` from a sentence you made up to satisfy the flag.

-------------------------------------------------------------------------------
6. DEFINITION OF DONE — restated
-------------------------------------------------------------------------------

A task is done only when ALL of the following are true, not "mostly true":

- [ ] Implementation matches the task as framed at kickoff
      (\`brain playbook start\`)
- [ ] \`brain verify\` green — every declared check, not just the ones you
      remembered to run
- [ ] Feature verification doc produced, if user-visible work — or
      explicitly marked N/A with a reason
- [ ] AI work only: suite re-run after the last edit, no frozen case failing,
      every fixed bug encoded as a new frozen case, human eval feedback
      answered — or the whole block explicitly marked N/A
- [ ] \`brain check\` — all harness invariants pass
- [ ] Every changed path's owning brain doc updated, or explicitly flagged as
      not
- [ ] Feature status flipped (\`brain ship\` / \`set-status\`) if the feature
      itself is done
- [ ] Run note closed, progress checkpoint written

If anything above is unmet, do not declare the task done — say exactly what's
blocking instead. A partial "done" reported as complete is worse than an
honest "blocked on X."
`,
  },
};
