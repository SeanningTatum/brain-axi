[brain-execute reference — agent topology and the claim conflict path]

-------------------------------------------------------------------------------
AGENT TOPOLOGY
-------------------------------------------------------------------------------

Three roles. Solo work collapses Coordinator and Worker into one session —
but NOT the Verifier: even solo, verification is handed to a fresh-context
agent (a sub-agent, or a new session reading only the brain). A fan-out
splits all three across processes/agents:

- **Coordinator.** Owns seeding tasks from the approved plan and deciding
  fan-out, and owns the final `brain features ship`. Handoff: OUT a
  `brain tasks view` brief per worker, IN each worker's evidence string.
  Escalation: never edits a file a worker holds a claim on; if two workers'
  evidence conflicts, re-opens the task (`brain tasks set <slug> <task> --status open`)
  rather than picking a winner.
- **Worker.** Owns exactly one task, start to evidence. Handoff: IN
  `brain tasks view`, OUT `brain tasks set --status done --evidence` composed
  only from observed output. Escalation: on a refused claim, re-list and take
  another task — never force a claim. On acceptance criteria it genuinely
  cannot meet, report back — do not quietly redefine the task.
- **Verifier (independent).** An agent with FRESH context that did not write
  the code under test — a sub-agent, or a new session. Owns two moments:
  reviewing the CONTRACT before any code (step 1b), and grading the built
  work against it (step 4, the `brain-verify` skill). Handoff: IN the task
  ids, their `--acceptance` + `--verify` lines, and the running product —
  never the implementer's summary of what it did; OUT a verdict (recorded
  with `brain verifications add`) with one row per acceptance criterion, each
  confirmed/refuted with a screenshot, a command + exit code + output (for
  what no browser reaches), or a `file:line` citation. Stance: adversarial —
  refutes by default when it cannot reproduce the evidence; "looks
  plausible" is not a confirmation, and a stub or display-only control is a
  FAIL, not a partial pass. Escalation: on a criterion it cannot test as
  written, sends it back to the contract rather than grading its own
  reinterpretation.

  **Self-verification** is allowed only when no second agent is possible at
  all (no sub-agent support, no second session). Then the verdict body
  declares it in its header — `- **Independence**: self-verified — <reason>`
  — and the recording names both identities: `brain verifications add <slug>
  --verdict PASS|FAIL|BLOCKED --body-from <file> --verified-by <who>
  --implemented-by <who>`. Never leave `--verified-by` defaulted to hide
  that the two are the same. "It was faster to check it myself" is not a
  reason.

  **Rigor scales with the plan's tier**: a **small**-tier plan needs the
  contract review plus a single fresh sub-agent as verifier; a **full**-tier
  plan needs an independent verifier, with a second adversarial pass on the
  riskiest tasks recommended. Detail and why: `references/rigor-and-ablation.md`.

Which role runs which command:

- `brain tasks add <slug> --title "..." --acceptance "..." --verify "..."
  [--depends-on t1,t2] [--files a,b]` — **coordinator only.** This is how
  the plan's phase list becomes state every command can read instead of
  prose living only in the coordinator's context window. `--verify` is the
  contract line agreed in step 1b: how the verifier will check it.
- `brain tasks view <slug> <task-id> [--full]` — how a **worker STARTS.**
  Read it FIRST, before anything else: it composes the task, its acceptance,
  its dependencies, the feature, and the run steps so far into one payload a
  cold agent can act on without trusting a paraphrase.
- `brain tasks claim <slug> --key <task-id> --by <name>` — **worker**,
  immediately after the brief. Refuses (exit 1) if someone else holds it, or
  if a dependency is unmet; on success it prints a claim token.
- `brain runs append <slug> --task <task-id> --author <name> --step "..."
  --observed "..."` — **worker**, same rule as step 3, with
  `--task`/`--author` attached so a coordinated step is attributed to both
  the task and the agent that ran it (both optional and additive — a step on
  work that isn't task-coordinated just omits them).
- `brain tasks set <slug> <task-id> --status done --evidence "..." --by <name>`
  — **worker**, once the acceptance criteria is demonstrably met (`--token
  <claim-token>` works in place of `--by`).
- `brain features ship <slug> --evidence "..."` — **coordinator's call**, not
  a worker's, with one gated exception: see GATED AUTOSHIP in
  `references/fix-loop-and-close.md`.

-------------------------------------------------------------------------------
THE CLAIM CONFLICT PATH — a worker never forces a claim
-------------------------------------------------------------------------------

`brain tasks claim` is atomic: when two workers race for the same task,
exactly one claim lands; the loser gets exit 1, never two workers both
believing they hold the same task. A claimed task only moves for its holder
(`--by` or `--token`).

The correct response to that refusal is always the same: `brain tasks list
<slug>` to re-list current state, then claim a DIFFERENT ready task. Never
retry the identical claim expecting a different result, never work around
the system to force it, and never treat "someone else has it" as license to
just start editing the same files outside the task system anyway. To give a
task back, release it with `brain tasks set <slug> <task-id> --status open --by <name>`
(or `--token <claim-token>`).
