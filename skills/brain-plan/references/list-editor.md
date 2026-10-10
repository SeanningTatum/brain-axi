[brain-plan reference — section 9: interactive review components]

-------------------------------------------------------------------------------
9. INTERACTIVE REVIEW COMPONENTS
-------------------------------------------------------------------------------
What it's for: decision cards (section 8) cover shortlist-of-options questions.
This section covers the rest of what a plan needs to be truly clickable: lists
that the reviewer edits in place (add/remove/rewrite an item without typing a
prompt), the submit discipline that keeps those edits from spamming duplicate
prompts, and a lavish-axi input pattern worth porting. Read
lavish-axi's own "input" guide for the underlying philosophy if you have
access to it; this section adapts that philosophy to the window.brain API and
the list-edit prompt tag.

--- 9.1 EDITABLE LIST COMPONENT (the flagship pattern) ---

Four sections in this skill are fundamentally editable lists: Plan of
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
something the agent reads as "never mind." The idiom this skill uses:
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
- data-lavish-question auto-scoping as something THIS skill teaches —
  brain-axi ports the underlying idea as automatic queueKey derivation
  inside the SDK itself (addendum v5, item 2: radio/checkbox/text derive a
  queueKey from a [data-brain-question] ancestor when none is passed), so
  authors get the behavior for free; this skill still shows explicit
  queueKey everywhere above because explicit beats derived for a reader
  trying to learn the shape, not because the automatic path is missing.
- a dedicated tag for tradeoff-table option selection distinct from
  "decision" — not needed; section 8 already covers the exact same shape
  (radio group + tradeoff table + one queued choice) and inventing a second
  tag for the same data would just be two names for one thing.

