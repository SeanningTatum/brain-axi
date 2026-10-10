[brain-plan reference — section 16: AI addendum]

-------------------------------------------------------------------------------
16. AI ADDENDUM — required when the plan touches prompts, models, or agents
-------------------------------------------------------------------------------
Skip this section entirely for ordinary deterministic work. Include it when
the plan proposes a prompt, a model call, a chain, retrieval, or an agent —
read `brain playbook ai` first, then add the following to the sections above:
two new sections, a gate folded into section 14, and (for multi-agent work) a
topology table. They exist because a plan for AI work that omits them is a
plan whose success cannot be judged.

- **Prompt contract** (place it right after section 9). For each prompt the
  plan introduces or changes: job in one sentence, inputs with realistic
  sizes, output shape the caller parses, known failure modes, and the model +
  settings pin. A reviewer should be able to tell what the prompt is
  responsible for without reading it.

- **Eval plan + golden set** (right after the prompt contract). Which suite
  measures this, how many cases and where they come from (real / synthetic /
  regression), the four coverage bands (typical, edge, adversarial,
  refusal-correct), the held-out slice, and which eval kind scores it
  (deterministic assertions / rubric + judge / human). State the baseline
  number if a suite already exists, or say plainly that building the suite is
  step one.

- **Regression gate** (fold into section 14's testing plan). What must never
  regress (the frozen cases), what tolerance the aggregate gets, and what
  makes you revert the change. "The number goes up" is not a gate.

- **Agent topology** (right before section 10's plan of record, if the work is
  multi-agent). A table of roles: name, model, tools, what it owns, its
  handoff contract, and its escalation rule. One row per role, and every
  phase in section 10 names the role that owns it.

Two decision cards worth adding by default when this addendum applies, since
both are shortlist questions a reviewer can click through in seconds:

- **Model choice** — the pin, with the cost/latency/quality tradeoff spelled
  out per option. Never leave this implicit; it silently sets the quality
  ceiling and the bill.
- **Eval kind** — deterministic assertions vs rubric + judge vs human sample,
  with what each one can and cannot see for THIS task.

Cost and latency belong in the plan too, in whatever section fits: a plan that
improves quality 5% at triple the cost per call is a tradeoff the human should
get to weigh, not a detail discovered after it ships.

