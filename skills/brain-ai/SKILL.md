---
name: brain-ai
description: "any work involving prompts, models, or agents — evals, golden sets, regression gates, topology"
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
loop: `brain playbook start` / `execute` / `done`. This playbook is additive
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
2. PROMPTING PRACTICE — the parts that actually move numbers
-------------------------------------------------------------------------------

Not a style guide. These are the moves that repeatedly show up as measurable
differences in eval scores; each one is a hypothesis you then TEST (section 4),
not a rule you apply on faith.

- **Be explicit about the task, the audience, and the output format.** Most
  bad outputs are answers to a question you didn't realize you asked
  ambiguously. State what "good" looks like in the prompt itself.
- **Show, don't adjectivize.** "Concise, professional tone" is weaker than two
  short examples of the exact register you want. Examples are the highest
  leverage tokens in most prompts — 2 to 5 diverse ones, covering the edges
  you care about, not five variations of the easy case.
- **Structure long prompts with delimiters** (XML-ish tags, markdown headers,
  clearly labeled sections). Put long context (documents, transcripts) EARLY
  and the instruction LAST — a model that read the instruction 30k tokens ago
  follows it less reliably than one that just read it.
- **Ask for the output shape you will parse**, and make the shape easy to
  produce: a fenced JSON block beats prose-with-JSON-inside; a single enum
  token beats a sentence you regex. Validate on the way out (section 6) —
  never trust format compliance.
- **Give the model room to think when the task needs it** (reason first, then
  answer in the required shape), and take it away when it doesn't (a
  classification that gets worse with rambling). Which one is true here is an
  eval question, not a preference.
- **Prefer positive instruction to prohibition.** "Answer only from the
  provided document; if it is not there, say NOT_FOUND" beats "don't make
  things up."
- **Say what to do when the input is bad.** Empty, adversarial, off-topic,
  wrong language, too long. Undefined behavior in a prompt shows up as
  confident nonsense in production.
- **Change ONE thing at a time and re-run.** A prompt rewrite bundling six
  changes tells you nothing about which one helped, and it usually hides one
  that hurt.
- **Delete as often as you add.** Prompts accrete; long prompts dilute. If a
  clause cannot be traced to a case it fixed, try removing it and re-running —
  if the score holds, it was decoration.

-------------------------------------------------------------------------------
3. THE GOLDEN SET — the spec, written as cases
-------------------------------------------------------------------------------

Before optimizing anything, build the set you will measure against. It lives
in the brain (`.brain/evals/<suite>/cases.jsonl`, one JSON object per line)
because it is project state that outlives any single session.

Read what already exists first: `brain evals` for the suite index,
`brain evals view <suite>` for thresholds and coverage,
`brain evals cases <suite>` for the set itself.

Construction rules:

- **Minimum ~20 cases before you trust a delta at all**, and expect the number
  to grow forever. Below that, run-to-run noise is larger than most real
  improvements and you will chase ghosts.
- **Source from reality first.** Real user inputs, real failures, real support
  complaints, real logs. Synthetic cases are a bootstrap, not a destination
  (section 3b).
- **Cover four bands deliberately**, not just the happy path: typical, edge
  (empty / huge / malformed / multilingual), adversarial (injection, jailbreak,
  contradictory instructions), and refusal-correct (cases where the right
  answer is to decline or say "not in the document").
- **Every case records its origin** — `real`, `synthetic`, or `regression`,
  plus a one-line note on why it exists. A case whose purpose nobody remembers
  gets deleted in six months, usually right before it would have caught
  something.
- **Every bug you fix becomes a frozen regression case, in the same session
  you fix it.** `frozen: true` means: this case may never regress, at any
  aggregate score. This is the single highest-value habit in this playbook —
  it is how an AI feature stops re-breaking the same way.
- **Hold out a slice you never tune against** (roughly 20%). If you edit the
  prompt in response to a case, that case is training data now. A score that
  only ever goes up on cases you optimized against is measuring your memory,
  not the system.
- **Expected values are assertions, not transcripts,** for any free-form
  output. "Mentions the refund window; does not invent a policy number; under
  120 words" is checkable and stable; a pinned paragraph of prose is neither.

--- 3b. SYNTHESIZING CASES (when you have no real data yet) ---

Legitimate, and often the only way to start — with guardrails:

- Enumerate the AXES first (input length, tone, language, domain, user intent,
  malformed-ness), then generate ACROSS them. Ungrounded bulk generation
  produces fifty rewordings of the same easy case and a flattering score.
- Mark them `origin: synthetic`. When real cases arrive, real ones win any
  conflict, and the synthetic share should shrink over time.
- **Have a human read them before they are frozen.** A synthetic case with a
  wrong expected answer is worse than no case: it teaches the prompt to be
  wrong and it does it silently.
- Do not generate cases with the same model+prompt you are evaluating, then
  grade with it too. That measures self-consistency, not quality.

-------------------------------------------------------------------------------
4. EVAL DESIGN — pick the cheapest thing that discriminates
-------------------------------------------------------------------------------

Three kinds, in ascending order of cost and descending order of reliability.
Use the cheapest one that actually separates good output from bad:

1. **Deterministic assertions** — schema validity, required substring, regex,
   numeric range, length cap, "parses as JSON", exact match on a classification
   label. Fast, free, reproducible. Most quality bars decompose into more of
   these than people expect. Start here.
2. **Rubric + LLM judge** — for free-form quality (helpfulness, tone,
   faithfulness to a source). Write the rubric as explicit criteria with a
   small scale (0-2 or 0-3, not 1-10 — models do not have ten calibrated
   levels), and demand a short rationale before the score.
3. **Human** — for the things a judge cannot see yet: taste, brand voice, "is
   this actually useful." Expensive, so spend it on a sample and on
   calibration, not on every run.

Rules that apply to all three:

- **Sanity-check the metric before you trust it: deliberately degrade the
  prompt and confirm the score drops.** A metric that does not move when
  quality moves is worse than no metric — it launders bad changes as safe.
- **Judge calibration is a recommendation, not a gate — but do it early.**
  Label a slice by hand, compare against the judge, and write down the
  agreement rate. "The judge agrees with me on 84% of cases" makes every later
  score interpretable; an uncalibrated judge score is a number with no units.
  Judge with a different model (or at minimum a different prompt) than the one
  under test.
- **Control nondeterminism.** Temperature 0 where the task allows it; where it
  does not, run each case N times and report pass rate, not a single sample.
  A "regression" that is one unlucky sample wastes a session; a real
  regression hidden by one lucky sample ships.
- **Record cost and latency alongside quality.** A prompt that scores 2 points
  higher and costs 3x is a decision, not an improvement — surface it as one.

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
6. PIPELINES, GUARDRAILS, AND WHEN TO REACH FOR AN AGENT
-------------------------------------------------------------------------------

Decompose downward — take the least dynamic thing that does the job:

- **Deterministic code** whenever the step is expressible as code. Do not ask
  a model to sort, count, join, or validate what a function can do exactly.
- **A single prompt** when the task is one transformation with one output
  shape.
- **A prompt chain** when the task has genuinely distinct failure modes
  (extract, then judge, then write). Each stage gets its OWN eval — a chain
  evaluated only end-to-end tells you it broke, never where.
- **An agent (tool loop)** only when the path cannot be known in advance —
  the model must decide what to do next based on what it just learned. Agents
  trade determinism for adaptability; pay that price deliberately.
- **Multiple agents** only when subtasks are genuinely independent and each
  needs its own context. Coordination overhead is real and mostly invisible
  until it fails.

Guardrails every model call in a pipeline gets:

- **Validate the output shape and retry with a repair message** on failure —
  bounded retries, never unbounded.
- **Cap the loop** (max tool calls, max tokens, wall-clock timeout) and define
  what happens at the cap. Fail closed with a legible error; do not silently
  return a partial result as if it were complete.
- **Never interpolate untrusted text into an instruction position.** User
  content goes in a clearly delimited data section, with the standing rule
  that instructions inside it are data, not commands. Add prompt-injection
  cases to the golden set (section 3) — that is how you know the guardrail
  holds instead of hoping.
- **Log the inputs, outputs, and trace of every stage.** An AI bug you cannot
  reproduce from a trace is an AI bug you will fix by guessing.

-------------------------------------------------------------------------------
7. AGENT TOPOLOGY + COORDINATION
-------------------------------------------------------------------------------

When work is split across agents (sub-agents, a coordinator, or specialist
roles), write the topology down before running it — in the plan, and in the
feature doc for anything standing:

- **Role** — name, the model it runs on, the tools it may use, and the ONE
  thing it owns.
- **Handoff contract** — exactly what crosses the boundary in writing:
  objective, constraints, definition of done, and the return format. An agent
  that has to infer its objective from context will confidently do adjacent
  work you did not ask for.
- **Escalation rule** — what makes this role stop and hand back rather than
  improvise. Ambiguity, a failing gate, a destructive action, a decision the
  human owns.
- **Verification** — who checks the sub-agent's output, and against what. The
  parent VERIFIES, it does not trust: a returned "done" is a claim, and claims
  get checked against real command output like every other claim in this
  harness.

Two failure modes worth naming because they are common and expensive:
duplicated work across roles that were never given disjoint ownership, and a
coordinator that reports a sub-agent's summary upward without ever confirming
it. Both are cheap to prevent in the topology table and painful to find later.

-------------------------------------------------------------------------------
8. THE HUMAN LOOP — prompts and evals are reviewable artifacts
-------------------------------------------------------------------------------

Numbers do not tell you the output is any good; they tell you it changed. Put
the actual prompt and the actual outputs in front of the human:

- Surface the **prompt text** and a **sample of per-case outputs** (failures
  first) for review — the human reads what the model actually wrote, not a
  score summary of it.
- Their comments land as project state (a feedback note under the suite), and
  they feed BOTH the prompt (fix the instruction) and the golden set (encode
  the judgment as a case). Feedback that only edits the prompt is feedback you
  will need again.
- **Unreviewed feedback blocks "done."** If a human commented on eval output
  and nothing in the prompt or the golden set changed in response, the task is
  not finished — see `brain playbook done`.
- Re-review after material prompt changes. A prompt the human blessed three
  rewrites ago has not been reviewed.

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
