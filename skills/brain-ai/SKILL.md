---
name: brain-ai
description: "Use for any work involving prompts, models, agents, or evals — prompt contracts, golden sets, regression gates, agent topology, model and eval-kind choices; baseline with brain evals before editing any prompt."
---
AI WORK PLAYBOOK
=================

You are about to plan, build, or change something whose output comes from a
model rather than from deterministic code. Everything the rest of this harness
assumes — a check that passes or fails, a diff that means what it says — stops
holding here. A prompt edit is a change with no compiler, no type error, and no
test that fails when you make it worse. This playbook is how that work becomes
checkable anyway.

One sentence to carry through all of it: **the eval set is the test suite, the
golden set is the spec, and a failing case is not a bug report — it is a new
golden case.**

-------------------------------------------------------------------------------
0. WHEN THIS APPLIES
-------------------------------------------------------------------------------

Apply this playbook when the work involves any of:

- a prompt (system, user, or template) whose text you are writing or editing;
- a model call whose output feeds a product surface, a decision, or another
  model;
- an agent, tool loop, or chain of model calls;
- retrieval or context assembly feeding any of the above.

Do NOT apply it to code that merely sits near AI features (a route that
forwards a request, a schema, a button). Deterministic code gets the ordinary
loop: the `brain-start` skill (`brain playbook start` if skills are unavailable) / `execute` / `done`. This playbook is additive
to those, never a replacement for them.

If you are unsure: does a rerun with identical inputs produce a materially
different output? If yes, you are in this playbook.

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

Storage rule for this harness: prompts live in the app repo next to the code
that sends them (one prompt per file, versioned by git). The brain holds a
pointer, the golden set, and the run history — never a divergent copy of the
prompt text.

-------------------------------------------------------------------------------
SECTIONS 2-4, 6-8 — READ WHEN YOU REACH THEM
-------------------------------------------------------------------------------

2. PROMPTING PRACTICE — the parts that move numbers.  Read `references/prompting.md` (`brain playbook ai --ref prompting`).
3. THE GOLDEN SET — the spec, written as cases (and 3b, synthesizing cases when there is no real data).  Read `references/golden-set.md` (`brain playbook ai --ref golden-set`).
4. EVAL DESIGN — pick the cheapest eval kind that discriminates.  Read `references/eval-design.md` (`brain playbook ai --ref eval-design`).
6. PIPELINES, GUARDRAILS, AND WHEN TO REACH FOR AN AGENT, and 7. AGENT TOPOLOGY + COORDINATION.  Read `references/pipelines-agents.md` (`brain playbook ai --ref pipelines-agents`).
8. THE HUMAN LOOP — prompts and evals are reviewable artifacts.  Read `references/human-loop.md` (`brain playbook ai --ref human-loop`).

-------------------------------------------------------------------------------
5. THE LOOP — how a prompt change actually gets made
-------------------------------------------------------------------------------

1. **Baseline.** `brain evals run <suite>` BEFORE touching anything. Same rule
   as `brain verify --stage baseline` for code: without a baseline you cannot
   tell your change apart from what was already broken. `brain evals` lists
   every suite with its last score and state (never-run / stale / regressed).
2. **Change one thing.** One hypothesis, stated: "adding two refusal examples
   should fix the four hallucinated-policy cases."
3. **Re-run the suite** — `brain evals run <suite>` again. It prints the
   per-case failures and the delta, not just an average: a change that fixes
   four cases and breaks two is a wash the aggregate would hide.
4. **Frozen cases are checked separately, and they are absolute.** Any frozen
   regression case that flips to failing kills the change outright, whatever
   the aggregate did — that is what `gate: fail` means in the run output.
5. **Record it as a run step** — `brain runs append <slug> --step "prompt: +2
   refusal examples" --observed "<the real before/after numbers>"`. Verbatim
   output, never a remembered summary.
6. **New failures become new cases** before you move on, not "later":
   `brain evals golden add <suite> --id <id> --input "..." --expected "..."
   --frozen`, or `brain evals golden freeze <suite> <case-id>` when the case
   already exists.
7. **Checkpoint with the delta** — `brain progress add --eval <suite>
   --summary "..." --next "..."`. The flag reads the score, delta, frozen
   failures and cost out of the suite's own run record, so the number in the
   checkpoint is one that was actually measured rather than one you
   remembered. A checkpoint on AI work with no number says nothing.
8. **Loop.** Stop when the hypothesis list is empty, not when the number is
   pretty.

Running a suite elsewhere (promptfoo, a python harness, an agent-scored pass)?
Record it instead of re-running: `brain evals record <suite> --from <file>
--adapter promptfoo`. The gate, the run history, and the checkpoint stamp all
work identically — brain reads the file your tool already wrote, and never
calls a model itself.

The gate runs as `brain verify --stage evals` (every suite, exit 1 on any
failure). It is opt-in and deliberately NOT part of an ordinary
`brain verify` — model calls cost money, and a gate that makes every
checkpoint expensive is a gate someone will quietly remove.

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

State these, briefly, the same way `brain playbook start` demands a readiness
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
