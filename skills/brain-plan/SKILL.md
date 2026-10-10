---
name: brain-plan
description: "Use when writing any plan, proposal, design, or approach review for human approval — write it as one HTML artifact, open it with brain review, and poll for feedback in the foreground until approved. Never print the plan in chat."
---
> CLI note: examples below say `brain <cmd>`. If `brain` is not on PATH, run `npx -y brain-axi <cmd>` instead.

PLAN ARTIFACT
=============

You are about to write a plan/proposal/design as ONE standalone HTML file that a
human will review inside "brain review" (an iframe'd artifact + sidebar showing
brain memory: prior plans, checkpoints, verifications, feature state). This is not a
markdown doc and not a chat message — it is a small web page. Read this whole
skill before writing anything, then follow the section structure in order.

Before you write: if this plan will carry any decision card and you have not
run the `brain-grill` skill, stop and run it. It settles what you can settle
with the human while the design is still soft, and its memory check keeps you
from asking a question this repo already answered. Grilling after the artifact
exists is not grilling — it is asking someone to ratify a design.

Four of those sections are conditional — 3, 6, 7, and 16. Each names the
skill that owns it, because the standard is too long to inline here and
too important to guess at:

- Sections 3 (product brief) and 7 (product decisions) fire on any USER-FACING
  change — a screen, a CLI surface someone invokes, an output format, a
  workflow. Read the `brain-product` skill before writing them.
- Section 6 (UI mockups + UX flows) fires when the plan adds or changes a
  SCREEN. Read the `brain-ux` skill before writing it.
- Section 16 (AI addendum) fires when the plan touches PROMPTS, MODELS, OR
  AGENTS. Read the `brain-ai` skill before writing it.

Skip a conditional section when it does not apply — an empty ceremony section
teaches the next agent that these are boxes to fill rather than work to do.

Why this matters: a reviewer should be able to grasp what's going on, what needs
deciding, and the big picture, WITHOUT reading code — and every decision you need
from them should be answerable by clicking, not by typing an essay.

PICK A TIER FIRST
-----------------

The 17-section structure is right for a feature that spans several layers and carries
real architectural risk. On a two-file change it is overhead, and the same
warning applies as to an empty conditional section: ceremony teaches the next
agent that these are boxes to fill.

Two tiers. Choose before writing, and state which one in the header strip
(section 1) so the reviewer can push back in a single annotation:

- **small** — sections 1 (header), 2 (TL;DR), 4 (context), 8 (decisions),
  10 (plan of record), 11 (files that change), plus 3 (product brief) when
  user-facing. Use when the change touches one surface, is cheap to reverse,
  and its shape is understood — most user-facing features of a small app.
- **full** — every section that applies, conditionals included. Use when the
  work spans layers, is expensive to reverse, or has several interacting
  decisions.

One rule picks the tier: **risk and size, never "user-facing" alone.**
User-facing work gets the product brief (section 3) in BOTH tiers; that does
not force full. **Decisions are never cut:** section 8 is in both tiers, and a
plan that hides its decisions to look small is the failure this tier exists to
prevent.

When risk and size leave it unclear, write small and let the review round tell
you what is missing.
Adding a section between rounds is cheap; a reviewer's attention spent on eleven
sections that did not need writing is not.

-------------------------------------------------------------------------------
THE 17-SECTION STRUCTURE — in order; the tier decides which you write
-------------------------------------------------------------------------------

0. SHARED FOUNDATIONS — one inline <style> block in <head>, no external stylesheet; one fixed light palette with exactly one accent. The copy-paste block and palette discipline: Read `references/style.md`.
1. HEADER STRIP (title, date, feature, TIER, status chip, round). 2. TL;DR (three sentences, hard cap). 3. PRODUCT BRIEF (conditional — the `brain-product` skill). 4. CONTEXT (run `brain plans list`, `brain progress list`, `brain features view <slug>`; cite real slugs and dates). 5. BIG PICTURE (one flowchart). 6. UI MOCKUPS + UX FLOWS (conditional — the `brain-ux` skill). 7. PRODUCT DECISIONS (conditional — the `brain-product` skill). Sections 1-7 in full, with markup: Read `references/sections.md`.
8. TECHNICAL DECISIONS NEEDED — one decision card per shortlist question: radio group, tradeoff table, one option pre-checked and labeled "(recommended)", a "Queue answer" button wired to `queueDecision`; every control carries data-brain-action. The full working snippet and notes: Read `references/decision-cards.md`.
9. INTERACTIVE REVIEW COMPONENTS — editable lists, restore/cancel, per-question submit. Components: Read `references/list-editor.md`.
10. PLAN OF RECORD (each phase: testable acceptance + a Verify: clause; product and high-level design only). 11. FILES THAT CHANGE. 12. GOLDEN PATH. 13. ERROR PATHS. 14. TESTING PLAN. 15. OPEN QUESTIONS. Sections 10-15 in full: Read `references/record-sections.md`.
16. AI ADDENDUM (conditional — the `brain-ai` skill; prompt contract, golden set + how it is judged, regression gate, agent topology). Section 16: Read `references/ai-addendum.md`.
DIAGRAMS (mermaid with an offline-safe SVG fallback) and other components Markdown cannot do.  Read `references/diagrams.md`.

-------------------------------------------------------------------------------
REVIEW LOOP — the default for every plan; never print the plan in chat
-------------------------------------------------------------------------------

1. Read the brain first (bare `brain`, `brain progress list`, `brain features list`, `brain plans list`, `brain search "<topic>"`; for a feature, `brain runs view <slug>` and `brain verifications list --feature <slug>`); grill first if the plan carries a decision. 2. Write the ONE HTML file (`<repo>/plans/<topic>.html` is a good default). 3. `npx -y brain-axi review open <plan.html> --feature <slug>` registers the plan and opens the review UI (a plan that introduces a new feature: first `brain features add <slug> --name "..." --description "..."`). 4. Immediately `npx -y brain-axi review poll <plan.html>` and wait IN THE FOREGROUND of the same turn — it blocks until the human clicks Send; never background it, never end your turn while it waits; on interruption re-run it. 5. Apply each requested change to the SAME file (anchored by the prompt's `line` + `text`), then `npx -y brain-axi review poll <plan.html> --agent-reply "what you changed"`. 6. Repeat until approved or ended; if `ended_by: user`, stop polling and do not reopen. Finish with `npx -y brain-axi review end <plan.html>` once approved. Headless/CI (no browser, a human already said yes): `npx -y brain-axi review end <plan.html> --approved-by <who>`. The review history is `brain plans view <slug>`. Poll rules (layout_warnings, snapshots) and the approved-snapshot rule: Read `references/review-flow.md`.

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

## Next

- While writing, as sub-skills that return here: `brain-product` when the change is user-facing (product brief + product decisions), `brain-ux` when a screen changes (mockups + flows), `brain-ai` when prompts, models, or agents are involved (AI addendum).
- After the human approves: use the `brain-execute` skill.
