[brain-ai reference — sections 3 and 3b: the golden set]

-------------------------------------------------------------------------------
3. THE GOLDEN SET — the spec, written as cases
-------------------------------------------------------------------------------

Before optimizing anything, build the set you will measure against. It lives
in the project's own repo, next to the prompt and the eval runner (one case
per line in a JSONL file, or whatever format the runner reads), because it is
project state that outlives any single session. brain stores no cases.

Read what already exists first: the suite's directory, its cases file, and
the runner's last output.

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
  aggregate score. This is the single highest-value habit in this skill —
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

