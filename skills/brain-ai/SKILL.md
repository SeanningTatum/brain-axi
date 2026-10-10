---
name: brain-ai
description: "Use for any work involving prompts, models, agents, or evals — prompt contracts, golden sets, regression gates, agent topology, model and eval-kind choices; baseline the project's own eval run before editing any prompt."
---
> CLI note: examples below say `brain <cmd>`. If `brain` is not on PATH, run `npx -y brain-axi <cmd>` instead.

AI WORK
=======

You are about to plan, build, or change something whose output comes from a
model rather than from deterministic code. Everything the rest of this harness
assumes — a check that passes or fails, a diff that means what it says — stops
holding here. A prompt edit is a change with no compiler, no type error, and no
test that fails when you make it worse. This skill is how that work becomes
checkable anyway.

One sentence to carry through all of it: **the eval set is the test suite, the
golden set is the spec, and a failing case is not a bug report — it is a new
golden case.**

-------------------------------------------------------------------------------
0. WHEN THIS APPLIES
-------------------------------------------------------------------------------

Apply this skill when the work involves any of:

- a prompt (system, user, or template) whose text you are writing or editing;
- a model call whose output feeds a product surface, a decision, or another
  model;
- an agent, tool loop, or chain of model calls;
- retrieval or context assembly feeding any of the above.

Do NOT apply it to code that merely sits near AI features (a route that
forwards a request, a schema, a button). Deterministic code gets the ordinary
loop: the `brain-start` / `brain-execute` / `brain-done` skills. This skill is additive
to those, never a replacement for them.

If you are unsure: does a rerun with identical inputs produce a materially
different output? If yes, you are in this skill.

-------------------------------------------------------------------------------
1. THE PROMPT CONTRACT — write it before you write the prompt
-------------------------------------------------------------------------------

Every prompt in the repo is an artifact with a contract, not a string literal
somewhere in a service file. Before editing or authoring one, write down (in
the plan, the feature doc, or a header comment beside the prompt itself):

- **Job** — one sentence. What this single prompt is responsible for. If you
  need two sentences joined by "and," you probably want two prompts (see
  section 6).
- **Inputs** — every variable interpolated in, with its source and its
  realistic size. "transcript (user upload, 2k-40k tokens)" — not "text".
- **Output shape** — the exact structure the caller parses. JSON schema, an
  enum, a fenced block, a single word. If a downstream parser exists, its
  expectations ARE the contract.
- **Failure modes you already know about** — refusal, truncation, invented
  facts, wrong language, over-length, schema drift. These become eval cases in
  section 3, one per line.
- **Model + settings pin** — model id, temperature, max tokens, tools
  available. **A prompt evaluated on one model is not evaluated on another.**
  Model changes are prompt changes: re-run the suite.
- **Owner** — the feature slug this prompt belongs to.

Storage rule: prompts live in the app repo next to the code that sends them
(one prompt per file, versioned by git), and so do the golden set and the
eval runner. The brain holds no copy of any of it and runs no evals — at most
the feature doc points at where they live.

-------------------------------------------------------------------------------
SECTIONS 2-4, 6-8 — READ WHEN YOU REACH THEM
-------------------------------------------------------------------------------

2. PROMPTING PRACTICE — the parts that move numbers.  Read `references/prompting.md`.
3. THE GOLDEN SET — the spec, written as cases (and 3b, synthesizing cases when there is no real data).  Read `references/golden-set.md`.
4. EVAL DESIGN — pick the cheapest eval kind that discriminates.  Read `references/eval-design.md`.
6. PIPELINES, GUARDRAILS, AND WHEN TO REACH FOR AN AGENT, and 7. AGENT TOPOLOGY + COORDINATION.  Read `references/pipelines-agents.md`.
8. THE HUMAN LOOP — prompts and evals are reviewable artifacts.  Read `references/human-loop.md`.

-------------------------------------------------------------------------------
5. THE LOOP — how a prompt change actually gets made
-------------------------------------------------------------------------------

1. **Baseline.** Run the project's eval suite BEFORE touching anything.
   Same rule as `brain verify run --stage baseline` for code: without a
   baseline you cannot tell your change apart from what was already broken.
   Note the per-case results, not just the average.
2. **Change one thing.** One hypothesis, stated: "adding two refusal examples
   should fix the four hallucinated-policy cases."
3. **Re-run the suite.** Compare per-case failures and the delta, not just an
   average: a change that fixes four cases and breaks two is a wash the
   aggregate would hide.
4. **Frozen cases are checked separately, and they are absolute.** Any frozen
   regression case that flips to failing kills the change outright, whatever
   the aggregate did.
5. **Write the result down** where the project keeps eval history — the
   runner's output file, the PR description, a commit body — with the real
   before/after numbers. Verbatim output, never a remembered summary.
6. **New failures become new cases** before you move on, not "later": add the
   input and expected assertion to the golden set, marked frozen when it
   guards a fixed bug.
7. **Report the delta.** A summary of AI work with no number says nothing;
   state the baseline, the new score, any flipped case, and the cost change.
8. **Loop.** Stop when the hypothesis list is empty, not when the number is
   pretty.

The suite and its runner belong to the project (promptfoo, a python harness,
a plain test file, an agent-scored pass — whatever fits); brain never calls a
model and stores nothing about evals. Keep an expensive runner opt-in in the
project's own tooling: model calls cost money, and a gate that makes every
change costly is a gate someone will quietly remove.

Gate discipline, in one line: **frozen cases are absolute; aggregate scores
get a tolerance band.** Fuzzy metrics flap, and a gate that flaps gets
disabled — which is the actual failure mode to design against.

Prompts are re-evaluated on: prompt text change, model or settings change,
retrieval/context-assembly change, tool definition change, and dependency
upgrades that touch any of those. **Nothing on that list is "just a config
change."**

-------------------------------------------------------------------------------
9. ANTI-PATTERNS — the ways this goes wrong
-------------------------------------------------------------------------------

- **Vibes-based iteration.** Trying three inputs by hand, liking the output,
  declaring it better. This is the default failure and everything above exists
  to replace it.
- **Tuning on the eval set** until the number is beautiful and the held-out
  slice is untouched. You optimized the measurement.
- **Judge = generator**, uncalibrated. The model grades its own homework and
  gives itself an A.
- **Chasing the aggregate** while frozen regression cases quietly rot.
- **Silent model drift** — an unpinned model version changes under you and
  nobody re-runs anything. Pin it; treat a bump as a prompt change.
- **Prompt edits with no re-run**, because "it was only a wording tweak."
  Wording tweaks are the entire mechanism by which prompts change behavior.
- **Golden set frozen in time** — no new cases in months means either nothing
  is failing (unlikely) or failures are not being encoded (certain).
- **Evals that never fail.** If the suite has been green for every run since
  it was written, it is too easy to be measuring anything.

-------------------------------------------------------------------------------
10. READINESS — before you start editing prompts
-------------------------------------------------------------------------------

State these, briefly, the same way the `brain-start` skill demands a readiness
statement:

- Which prompt(s) this touches, and their contract (section 1).
- Which suite measures it, how many cases, and the baseline number you just
  read from a real run.
- Your ONE hypothesis for this change.
- What would make you revert it.

If you cannot state the baseline because no suite exists, then building the
suite IS the task — do that first, and say so. A prompt change with no way to
tell whether it helped is not work, it is a coin flip with extra steps.

## Next

- Back to the `brain-plan` skill when planning (the plan's AI addendum); on an approved plan, continue with the `brain-execute` skill.
