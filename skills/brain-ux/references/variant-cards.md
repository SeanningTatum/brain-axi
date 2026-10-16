[brain-ux reference — section 5: variant decision cards]

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

