[brain-plan reference — section 8: technical decision cards]

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

