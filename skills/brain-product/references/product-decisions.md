[brain-product reference — section 7: product decision cards]

-------------------------------------------------------------------------------
7. PRODUCT DECISIONS
-------------------------------------------------------------------------------

Product decisions get their own section in the plan artifact — call it
"Product decisions," placed BEFORE the technical "Decisions needed" section
of the `brain-plan` skill (section 8). This was decision 5 of the approved
planning-ux plan, and the reasoning is worth repeating: the human answers
what you're building before how, and a bad product answer invalidates every
technical card below it.

Reuse the plan skill's decision-card structure exactly — the same
`decision-card` class, the same `data-brain-action` rule, the same
`queueDecision(...)` helper and queueKey discipline (`brain-plan` skill,
sections 8 and 9.3). Never invent a parallel mechanism; a second queuing path
is a second thing to keep in sync and a second thing a reviewer has to learn.

Every product decision card carries a RECOMMENDATION WITH RATIONALE — same
requirement as a technical card, stated plainly here because product cards
are where planners most often go soft: the planner takes a position and
defends it, in the same table row a technical card would use for pros/cons.
A decision card with no recommendation is the planner outsourcing its own
job to the reviewer — the reviewer is there to approve or redirect a
position, not to invent one from a blank multiple-choice list.

Frame the question in the USER's terms, not the implementation's. "Should
scope tiers use a JSON array or a markdown table" is implementation-framed
and does not belong here at all (it goes in the plan skill's technical
decisions, if anywhere). "Should the reviewer be able to approve a smaller
version of this feature without a second planning round" is product-framed —
it is the same underlying decision as "scope tiers, yes or no," stated as a
question about what the reviewer can do.

    IMPLEMENTATION-FRAMED (wrong section, wrong question):
    "Should the wireframe kit ship as inline <style> or a linked
    stylesheet?"

    PRODUCT-FRAMED (right question, right section):
    "Should a plan that changes a screen require a wireframe before the
    reviewer can approve it, or is a written description enough?"

Full worked product decision card — copy this shape, adjust ids, copy, and
table rows per question. It reuses the exact classes and helper from
the `brain-plan` skill's section 8, verbatim:

    <section id="product-decisions">
      <h2>Product decisions</h2>

      <div class="decision-card" id="decision-gate-strictness" data-brain-action>
        <p><strong>1. Should a plan that changes a screen require a wireframe
        before a human can approve it?</strong></p>
        <table>
          <thead><tr><th></th><th>Option</th><th>Pros</th><th>Cons</th></tr></thead>
          <tbody>
            <tr>
              <td><input type="radio" name="decision-gate-strictness" id="gs-required"
                value="Required: no approval without a wireframe" checked data-brain-action></td>
              <td><label for="gs-required">Required
                <span class="tag-recommended">(recommended)</span></label></td>
              <td>Reviewer never approves a screen they can't picture</td>
              <td>Blocks approval on the agent producing a mockup first</td>
            </tr>
            <tr>
              <td><input type="radio" name="decision-gate-strictness" id="gs-optional"
                value="Optional: written description is enough" data-brain-action></td>
              <td><label for="gs-optional">Optional</label></td>
              <td>Faster for trivial screen tweaks</td>
              <td>The exact case that produced the 2.3-round average this
                feature exists to fix</td>
            </tr>
          </tbody>
        </table>
        <button type="button" class="btn-queue" data-brain-action
          onclick="queueDecision('decision-gate-strictness',
            'Should a plan that changes a screen require a wireframe before approval?')">
          Queue answer
        </button>
        <span class="queue-ack" id="ack-decision-gate-strictness"></span>
      </div>
    </section>

Note what did NOT change from the plan skill's version (section 8): the class names
(`decision-card`, `tag-recommended`, `btn-queue`, `queue-ack`), the
`data-brain-action` attribute on the card and on every input and button, the
`queueDecision(cardId, question)` call signature, and the queueKey
discipline (the card's own id, so re-queuing after changing the radio
REPLACES rather than stacks). The only things that change per card are the
ids, the question, the table rows, and which option is `checked`. If you
find yourself writing a new script function to queue a product decision,
stop — you are duplicating `queueDecision`, which already handles this.

