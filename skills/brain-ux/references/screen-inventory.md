[brain-ux reference — section 2: screen inventory]

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

