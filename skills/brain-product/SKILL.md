---
name: brain-product
description: "Use while planning user-facing work (a CLI command or flag, an output format, a screen, a workflow) — writes the product case first: problem with evidence, user and job, a numeric success metric, non-goals, scope tiers, product decision cards."
---
> CLI note: examples below say `brain <cmd>`. If `brain` is not on PATH, run `npx -y brain-axi <cmd>` instead.

PRODUCT CASE PLAYBOOK
=====================

You are about to write the product case for a plan before its technical shape
exists. It fires BEFORE the technical sections of the `brain-plan` skill (`brain playbook plan` if skills are unavailable) — it
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
  the `brain-ux` skill (`brain playbook ux` if skills are unavailable) once a screen is actually involved — read that one too);
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
ORDERED STEPS
-------------------------------------------------------------------------------

Write these in order, before any technical section of the plan. Each section is in the references; read it before writing that part.

1. PROBLEM + EVIDENCE — a real problem with a quote, count, or observed failure. 2. USER + JOB TO BE DONE — name who, and the job. 3. SUCCESS METRIC — one number with a baseline and a target. 4. NON-GOALS — what you decline, with reasons. 5. SCOPE TIERS — thin / complete / gold, mapped onto the plan of record's phases. 6. PRIOR ART — what exists in this repo and elsewhere.
Sections 1-6 in full (worked examples included): Read `references/case-sections.md` (`brain playbook product --ref case-sections`).
7. PRODUCT DECISIONS — the WHAT questions as decision cards, each with a recommendation and rationale, before any technical card. Full standard and a worked card: Read `references/product-decisions.md` (`brain playbook product --ref product-decisions`).

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

## Next

- Back to the `brain-plan` skill — the product case feeds the plan's product brief and product decisions; continue with the technical sections.
