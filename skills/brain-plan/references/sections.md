[brain-plan reference — sections 1-7]

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

