---
name: brain-product
description: "any plan for user-facing work — the product case before the technical one"
---
PRODUCT CASE PLAYBOOK
=====================

You are about to write the product case for a plan before its technical shape
exists. It fires BEFORE the technical sections of `brain playbook plan` — it
produces the product-facing sections of the plan artifact (problem,
user/job-to-be-done, success metric, non-goals, scope tiers, prior art) and
the product decision cards that go in their own section, ordered before the
technical decisions section from `brain playbook plan` (section 8).
Read that playbook if you have not already; this one reuses its decision-card
markup, `data-brain-action` rule, and `queueDecision(...)` helper verbatim —
it does not invent a parallel mechanism.

Every worked example below invents its slugs, dates, and numbers to show the
SHAPE of a good answer — none of them are real measurements from this repo.
Yours must be real: run the command, quote what came back.

One sentence to carry through all of it: **a product brief is the argument for
why this is the right thing to build, made before you know how — write it
after the technical plan and it stops being a decision and becomes a
justification for one that was already made.**

-------------------------------------------------------------------------------
0. WHEN THIS APPLIES
-------------------------------------------------------------------------------

Apply this playbook to any plan for USER-FACING work — a change to what a
person's, or an agent's, experience of the product is. Concretely, required
for:

- a new or changed screen, wireframe, or UI flow (this pairs with
  `brain playbook ux` once a screen is actually involved — read that one too);
- a new or changed CLI command, flag, or output shape that a human or an
  agent invokes;
- a new or changed output format (a TOON shape, a file layout, a generated
  artifact);
- a workflow change that alters what a user does, in what order, to get
  something done.

Do NOT apply it to:

- an internal refactor with no observable behavior change;
- a dependency bump;
- pure infrastructure (CI config, build tooling, deploy scripts) with no
  surface a user touches;
- a bug fix that restores previously-working behavior to spec — the product
  case for that behavior was already made when the feature shipped; don't
  re-litigate it, though a one-line note in Context is fine.

If you are unsure: does an agent's or a human's next command, screen, or
output look or behave differently after this ships? If yes, you are in it. A
refactor that quietly moves data around without changing anyone's next move
is out; the same refactor that also drops a flag or changes an error string
is in.

-------------------------------------------------------------------------------
1. PROBLEM + EVIDENCE
-------------------------------------------------------------------------------

State the problem as something happening to someone, not as a technical gap.
"The plan playbook has no product structure" describes an absence; "reviewers
approve technical plans without knowing who they're for, and a plan shipped
last month that nobody had actually asked for" describes a problem.

Cite evidence from real sources — never assert a problem from memory:

- `brain progress` / `brain timeline` — checkpoints and run notes that
  describe the pain as it happened;
- `brain plans` / `brain plans view <slug>` — a prior plan that hit this wall;
- `brain search "<term>"` — feedback docs, transcripts, or emails sections
  that name it in someone's own words;
- direct quotes from the user, verbatim, with a date.

    REJECTED (vague, no evidence):
    "Plans would be better if they had more product thinking."

    FIXED (evidence-cited):
    "Per the 2026-07-14 checkpoint ('mockup review round 2 — reviewer asked
    who this is even for, plan had no answer') and plan
    2026-07-20-notify-batching (approved, then reverted at ship per the
    2026-07-25 checkpoint — nobody had confirmed batching was wanted), plans
    in this harness ship a technical shape with no argument for why it is
    the right one. Two of the last four plans needed a second review round
    specifically because the reviewer's first question was 'who is this
    for' and the plan had not answered it."

The fixed version is checkable — a reader can run
`brain plans view 2026-07-20-notify-batching` and see the same thing you saw.
The vague one is an opinion with no way to verify it.

-------------------------------------------------------------------------------
2. USER + JOB TO BE DONE
-------------------------------------------------------------------------------

Name who, specifically, and the job they are trying to get done when they
reach for this — not what feature they will use, the job. "Users want a
faster CLI" names nobody and no job. "An agent running `brain playbook start`
at the top of a session wants to leave with a readiness statement it can act
on within thirty seconds, without reading source" names an actor and a job.

In this repo the user is frequently an AGENT, not a human. That is not a
metaphor: an agent reading TOON output, deciding whether to retry a command,
or following a `help:` line is a user with a job to be done, exactly the same
way a person clicking through a UI is. Treat "the calling agent" as seriously
as "the on-call engineer" or "the new hire" — ask the same questions. What
does it already know? What does it see right before this moment? What does
it do with the output? What does it do if the output is wrong?

Ban the plural-anonymous "users." It names nobody, so any claim about their
needs is unfalsifiable. If your draft has "users will appreciate X," stop and
answer: which user, in which command, in the middle of what job? If you
cannot answer that in one sentence, you don't have a user yet — you have a
placeholder for having thought about one.

    REJECTED: "Users want clearer error messages."

    FIXED: "An agent that runs `brain shots add` for a feature whose
    screenshots directory does not exist yet has to discover the directory
    convention from an error, mid-task, with no way to tell whether it
    mistyped the slug or the feature simply has no shots. Its job is to
    self-correct without escalating to a human."

    (That FIXED example is illustrative — invented, like every other worked
    example here. Do not quote a CLI error string you have not just run:
    brain-axi's own errors already carry a `help:` line naming the next
    step, so an example asserting otherwise would be teaching a fiction
    about the tool the reader is holding.)

-------------------------------------------------------------------------------
3. SUCCESS METRIC
-------------------------------------------------------------------------------

One measurable statement, with a number, plus how it gets observed. Be
honest that most repo work has no instrumented metric yet — use the fallback
ladder instead of skipping the section:

1. **Instrumented number** — a metric already collected (an eval score, a
   latency figure, an error rate) with a before/after and a target.
2. **Countable proxy** — something you can literally count with no new
   instrumentation: an eval score delta, checkpoint count needed to ship a
   feature, `brain search` calls needed to find something, command
   invocation counts read off `brain timeline`.
3. **A stated observable behavior change with a named check** — no number
   exists yet, so name the exact command or state that must differ and how
   you would check it by hand. This is the honest floor, not an excuse to
   skip the section.

Forbidden, unconditionally: "improves UX," "faster," "better," "cleaner"
with no operand. Each of these is a real claim wearing a costume — "faster"
asks "faster at what, measured how, from what baseline," and if you can't
answer that, you don't have a metric.

    REJECTED: "This makes planning better for agents."

    FIXED (tier 2, countable proxy): "Plans that touch a screen currently
    need 2.3 review rounds on average (last 6 plans, per `brain plans`)
    before approval, because the mockup arrives after the reviewer already
    approved the technical shape. Target: 1 round for screen-touching
    plans, measured the same way over the next 6 plans of this kind."

If you genuinely cannot state even tier 3, that is a signal the deliverable
might not be user-facing after all — go back to section 0.

-------------------------------------------------------------------------------
4. NON-GOALS
-------------------------------------------------------------------------------

State what this deliberately does not do, and why. A real non-goal is
something a reader would reasonably expect from the problem statement, that
you are explicitly declining, with a reason. A fake non-goal pads the
section with things nobody was going to ask for in the first place.

    REJECTED (fake — nobody expected this):
    "Non-goal: rewriting the TOON encoder."

    FIXED (real — a reasonable reader would expect this, and it's declined
    with a reason):
    "Non-goal: automatically detecting whether a plan 'needs' this
    playbook. A reader of section 0 might expect the CLI to gate on it —
    it doesn't; the agent self-applies the test in section 0 by judgment,
    because a heuristic here (grep the plan for the word 'screen') would
    both false-positive on prose that mentions a screen in passing and
    false-negative on a workflow change that never uses the word."

Two or three non-goals is usually right. More than that and you are probably
listing scope-cut decisions that belong in section 5 instead.

-------------------------------------------------------------------------------
5. SCOPE TIERS
-------------------------------------------------------------------------------

Give the human a cut lever: three tiers — thin / complete / gold — each
stating what ships, what it costs roughly, and what it leaves on the table.
The point is that a reviewer can approve the smaller tier without a second
round of planning; the tiers ARE the negotiation, done in advance instead of
live in the review thread. Write each tier as three lines — Ships / Costs /
Leaves on the table — worked example (this playbook's own feature,
planning-ux):

    Thin: the `product` playbook only, wired into `plan` as a conditional
      branch. Ships: problem/user/metric/non-goals/scope-tiers/prior-art
      sections plus product decision cards. Costs: ~1 phase. Leaves on the
      table: no wireframes (`ux` playbook), no sign-off persistence.

    Complete: `product` + `ux` playbooks, both wired into `plan`, bookend
      wiring at `start`/`done`, skill regenerated. Costs: ~3 phases. Leaves
      on the table: an approved mockup isn't checked against the shipped
      screenshot later — it can be approved and then drift.

    Gold: complete, plus a gated phase — the approved mockup persisted as
      verification evidence, `verify` playbook diffing the shipped
      screenshot against it. Costs: ~4 phases. Leaves on the table: nothing
      this plan identified.

The plan of record (`brain playbook plan` section 10) must be phased so tier
boundaries land ON phase boundaries — thin should be reachable by stopping
after some prefix of the phases, not by re-deriving a different plan. If
accepting "thin" would require restructuring the phases rather than just
stopping early, the phasing is wrong, not the tiers.

-------------------------------------------------------------------------------
6. PRIOR ART
-------------------------------------------------------------------------------

Name what already exists and why this proposal differs — grounded in what
you actually read, never invented. Run these before writing the section, not
from memory:

- `brain plans` — every prior plan artifact; check whether one already
  attempted this ground.
- `brain timeline` — checkpoints, run notes, plan creations, and review
  rounds merged into one feed — the fastest way to see whether this idea has
  come up and stalled before.
- `brain search "<term>"` — full-text search across rules/recipes/codebase/
  features/etc for a prior decision or an existing convention.
- `brain features` — a shipped or cut feature that already covers part of
  this ground. A `cut` feature with a reason is prior art too: it tells you
  what NOT to re-propose without a new argument.

For anything outside this repo — a competitor's UX, a library, a pattern
from another codebase — name it specifically (a URL, a repo, a screenshot)
and say what you actually looked at, not what you assume it does.

    REJECTED (asserted, not read):
    "Other planning tools already do scope tiers, so this isn't new, but
    ours will be simpler."

    FIXED (grounded in what was read):
    "`brain search 'scope tier'` and `brain plans` turn up nothing — this
    repo has never had a scope-tier convention. The closest prior art is
    the `ai` playbook's baseline/regression-gate framing (`brain playbook
    ai` section 5), which this borrows the honesty-about-uncertainty tone
    from but not the mechanism; evals have a number to gate on, most
    product decisions don't."

If prior art turns up a previous attempt that was cut or reverted, say so and
say why this attempt is different — a reader who remembers the cut feature
will ask whether you knew about it.

-------------------------------------------------------------------------------
7. PRODUCT DECISIONS
-------------------------------------------------------------------------------

Product decisions get their own section in the plan artifact — call it
"Product decisions," placed BEFORE the technical "Decisions needed" section
from `brain playbook plan` (section 8). This was decision 5 of the approved
planning-ux plan, and the reasoning is worth repeating: the human answers
what you're building before how, and a bad product answer invalidates every
technical card below it.

Reuse the plan playbook's decision-card structure exactly — the same
`decision-card` class, the same `data-brain-action` rule, the same
`queueDecision(...)` helper and queueKey discipline (`brain playbook plan`
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
and does not belong here at all (it goes in the plan playbook's technical
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
`brain playbook plan` section 8, verbatim:

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

Note what did NOT change from the plan playbook's version (section 8): the class names
(`decision-card`, `tag-recommended`, `btn-queue`, `queue-ack`), the
`data-brain-action` attribute on the card and on every input and button, the
`queueDecision(cardId, question)` call signature, and the queueKey
discipline (the card's own id, so re-queuing after changing the radio
REPLACES rather than stacks). The only things that change per card are the
ids, the question, the table rows, and which option is `checked`. If you
find yourself writing a new script function to queue a product decision,
stop — you are duplicating `queueDecision`, which already handles this.

-------------------------------------------------------------------------------
8. ANTI-PATTERNS — the ways this goes wrong
-------------------------------------------------------------------------------

- **Plausible filler.** "Improve the experience for users." Fix: name the
  user (section 2) and state the metric (section 3) — if you can't, you
  don't have a product case yet, you have a mission statement.
- **A metric invented to satisfy the section.** A number with no source, no
  baseline, and no plan to observe it again. Fix: use the fallback ladder in
  section 3 honestly — a tier-3 named observable check beats a fabricated
  tier-1 number.
- **Non-goals that are actually unstated goals.** "Non-goal: making this
  perfect" — nobody was asking for perfect, so declining it declines
  nothing. Fix: a real non-goal is something a reader would reasonably
  expect and you are explicitly cutting, with a reason (section 4).
- **Scope tiers that are the same tier three times** with different
  adjectives. If thin/complete/gold don't differ in what ships, what it
  costs, and what it leaves on the table, you have one tier with three
  names. Fix: make thin genuinely smaller — something a reviewer could
  approve alone and ship on its own.
- **Recommendation-free decision cards.** A radio group with nothing
  pre-checked, or a pros/cons cell left blank. Fix: take a position in
  section 7's card — every technical decision card in `brain playbook plan`
  does this; product cards are not exempt.
- **Prior art asserted without reading anything.** "Other tools already
  solve this," with no command run and no source named. Fix: actually run
  `brain plans` / `brain timeline` / `brain search` / `brain features`
  (section 6) before writing the sentence, and cite what came back —
  including a null result.
- **The product brief written after the technical plan.** Writing sections
  0-7 once the phases and files are already decided does not produce a
  decision, it produces a justification for one already made — the metric
  will match whatever ships, the non-goals will match whatever you didn't
  feel like building, and the recommendation will match whatever you
  already wrote. This playbook runs BEFORE `brain playbook plan`'s
  technical sections, not as cleanup after them.

-------------------------------------------------------------------------------
9. READINESS
-------------------------------------------------------------------------------

State these, briefly, before moving on to `brain playbook plan`'s technical
sections:

- [ ] Section 0 checked — this is genuinely user-facing, not an internal
      refactor wearing a user-facing plan's format.
- [ ] Problem stated with cited evidence (a real `brain` command's output,
      or a verbatim quote), not asserted from memory.
- [ ] A specific user is named — a role, or "the calling agent doing X" —
      never "users."
- [ ] Success metric has a number, or an honest tier-3 fallback with a
      named check — never a bare "better" or "faster."
- [ ] Two or three real non-goals, each something a reader would expect and
      you're declining, with a reason.
- [ ] Thin / complete / gold scope tiers exist and map onto the technical
      plan's actual phase boundaries.
- [ ] Prior art cites real command output (`brain plans`, `brain timeline`,
      `brain search`, `brain features`), including any null result.
- [ ] Every product decision card has a recommendation with rationale, and
      reuses the plan playbook's `decision-card` / `queueDecision` mechanism
      verbatim.

If any box is unchecked, do not proceed to `brain playbook plan`'s technical
sections — a technical plan built on top of an unfinished product case will
answer the wrong question precisely.
