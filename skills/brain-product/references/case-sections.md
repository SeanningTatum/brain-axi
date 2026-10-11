[brain-product reference — sections 1-6: problem, user, metric, non-goals, scope tiers, prior art]

-------------------------------------------------------------------------------
1. PROBLEM + EVIDENCE
-------------------------------------------------------------------------------

State the problem as something happening to someone, not as a technical gap.
"The plan skill has no product structure" describes an absence; "reviewers
approve technical plans without knowing who they're for, and a plan shipped
last month that nobody had actually asked for" describes a problem.

Cite evidence from real sources — never assert a problem from memory:

- `brain progress list` / `brain runs view <slug>` — checkpoints and run notes that
  describe the pain as it happened;
- `brain plans list` / `brain plans view <slug>` — a prior plan that hit this wall;
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
faster CLI" names nobody and no job. "An agent running bare `brain`
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

    FIXED: "An agent that runs `brain verifications add` with a `--shot` path that does not
    exist yet has to discover the screenshot-directory convention from an
    error, mid-task, with no way to tell whether it mistyped the path or the
    file was never saved. Its job is to
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

1. **Instrumented number** — a metric already collected (a test pass rate, a
   latency figure, an error rate) with a before/after and a target.
2. **Countable proxy** — something you can literally count with no new
   instrumentation: a failing-test count, checkpoint count needed to ship a
   feature, `brain search` calls needed to find something, command
   invocation counts read off `brain runs view <slug>`.
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
    need 2.3 review rounds on average (last 6 plans, per `brain plans list`)
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
    skill. A reader of section 0 might expect the CLI to gate on it —
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
Leaves on the table — worked example (this skill's own feature,
planning-ux):

    Thin: the `brain-product` skill only, wired into `plan` as a conditional
      branch. Ships: problem/user/metric/non-goals/scope-tiers/prior-art
      sections plus product decision cards. Costs: ~1 phase. Leaves on the
      table: no wireframes (`brain-ux` skill), no sign-off persistence.

    Complete: `brain-product` + `brain-ux` skills, both wired into `plan`, bookend
      wiring at `start`/`done`, skill regenerated. Costs: ~3 phases. Leaves
      on the table: an approved mockup isn't checked against the shipped
      screenshot later — it can be approved and then drift.

    Gold: complete, plus a gated phase — the approved mockup persisted as
      verification evidence, `brain-verify` skill diffing the shipped
      screenshot against it. Costs: ~4 phases. Leaves on the table: nothing
      this plan identified.

The plan of record (section 10 of the `brain-plan` skill) must be phased so tier
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

- `brain plans list` — every registered plan; check whether one already
  attempted this ground (`brain plans view <slug>` for its review rounds).
- `brain progress list` and `brain runs view <slug>` — checkpoints and run
  notes — the fastest way to see whether this idea has come up and stalled
  before (`brain verifications list --feature <slug>` for what was checked).
- `brain search "<term>"` — full-text search across features, docs,
  checkpoints, run steps and verifications for a prior decision or an
  existing convention (narrow with `--kind`).
- `brain features list` — a shipped or cut feature that already covers part of
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
    the `brain-ai` skill's baseline/regression-gate framing, which this borrows the honesty-about-uncertainty tone
    from but not the mechanism; golden sets have a number to gate on, most
    product decisions don't."

If prior art turns up a previous attempt that was cut or reverted, say so and
say why this attempt is different — a reader who remembers the cut feature
will ask whether you knew about it.

