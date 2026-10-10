[brain-ai reference — sections 6 and 7: pipelines, guardrails, agent topology]

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

