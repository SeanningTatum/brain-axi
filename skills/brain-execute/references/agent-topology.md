[brain-execute reference — agent topology and the CAS conflict path]

-------------------------------------------------------------------------------
AGENT TOPOLOGY
-------------------------------------------------------------------------------

Three roles. Solo work collapses Coordinator and Worker into one session —
but NOT the Verifier: even solo, verification is handed to a fresh-context
agent (a sub-agent, or a new session reading only the brain). A fan-out
splits all three across processes/agents:

- **Coordinator.** Owns seeding tasks from the approved plan and deciding
  fan-out, and owns the final `brain ship`. Handoff: OUT a `brain brief`
  payload per worker, IN each worker's evidence string. Escalation: never
  edits a file a worker holds a claim on; if two workers' evidence conflicts,
  re-opens the task rather than picking a winner.
- **Worker.** Owns exactly one task, start to evidence. Handoff: IN
  `brain brief`, OUT `brain tasks done --evidence` composed only from
  observed output. Escalation: on a CAS conflict, re-list and take another
  task — never force a claim. On acceptance criteria it genuinely cannot
  meet, report back — do not quietly redefine the task.
- **Verifier (independent).** An agent with FRESH context that did not write
  the code under test — a sub-agent, or a new session. Owns two moments:
  reviewing the CONTRACT before any code (step 1b), and grading the built
  work against it (step 4, `brain playbook verify`). Handoff: IN the task
  ids, their `--acceptance` + `--verify` lines, and the running product —
  never the implementer's summary of what it did; OUT a verdict doc with one
  row per acceptance criterion, each confirmed/refuted with a screenshot, a
  command + exit code + output (for what no browser reaches), or a
  `file:line` citation. Stance: adversarial — refutes by default when it
  cannot reproduce the evidence; "looks plausible" is not a confirmation, and
  a stub or display-only control is a FAIL, not a partial pass. Escalation:
  on a criterion it cannot test as written, sends it back to the contract
  rather than grading its own reinterpretation.

  **Self-verification** is allowed only when no second agent is possible at
  all (no sub-agent support, no second session). Then the verdict doc
  declares it in its header — `- **Independence**: self-verified — <reason>`
  — and the receipt records it: `brain receipt <slug> --verified-by <who>
  --implemented-by <who>` (`brain check --strict` warns when the two are
  the same identity, and never passes a defaulted `--verified-by`). "It was faster to check it myself" is not a reason.

  **Rigor scales with the plan's tier** (`brain playbook plan`): a
  **small**-tier plan needs the contract review plus a single fresh sub-agent
  as verifier; a **full**-tier plan needs an independent verifier, with a
  second adversarial pass on the riskiest tasks recommended. A separate
  verifier costs a context load; it is worth it whenever the work sits
  beyond what one agent reliably gets right alone — which is most work worth
  a plan.

Which role runs which command:

- `brain tasks add <slug> --title "..." --acceptance "..." --verify "..."
  [--depends-on t1,t2] [--files a,b]` — **coordinator only.** This is how
  the plan's phase list becomes a file every command can read instead of
  prose living only in the coordinator's context window. `--verify` is the
  contract line agreed in step 1b: how the verifier will check it.
- `brain brief <slug> <task-id> [--full]` — how a **worker STARTS.** Read it
  FIRST, before anything else: it composes the task, its acceptance, the
  approved decision prompts from the plan's `reviews.jsonl`, and the rules
  docs owning its declared files, into one payload a cold agent can act on
  without reading the plan artifact or trusting a paraphrase.
- `brain tasks claim <slug> <task-id> --owner <name>` — **worker**,
  immediately after the brief. Compare-and-swap: refuses (exit 1) if someone
  else holds it, or if a `depends_on` is unmet.
- `brain runs append <slug> --task <task-id> --author <name> --step "..."
  --observed "..."` — **worker**, same rule as step 3 below, with
  `--task`/`--author` attached so a coordinated step is attributed to both
  the task and the agent that ran it (both optional and additive — a step on
  work that isn't task-coordinated just omits them).
- `brain tasks done <slug> <task-id> --evidence "..."` — **worker**, once
  the acceptance criteria is demonstrably met.
- `brain ship <slug> --evidence "..."` — **coordinator's call**, not a
  worker's, with one gated exception: see GATED AUTOSHIP below.

-------------------------------------------------------------------------------
THE CAS CONFLICT PATH — a worker never forces a claim
-------------------------------------------------------------------------------

`brain tasks claim` is compare-and-swap: the write only lands if tasks.json
is unchanged since the read behind it. When two workers race for the same
task, exactly one claim lands; the loser gets exit 1 — naming the current
owner, or "re-read and retry" on a raw write race — never a corrupted
tasks.json, never two workers both believing they hold the same task.

The correct response to that refusal is always the same: `brain tasks
<slug>` to re-list current state, then claim a DIFFERENT open task. Never
retry the identical claim expecting a different result, never hand-edit
tasks.json to force it, and never treat "someone else has it" as license to
just start editing the same files outside the task system anyway.

One note for anyone reading `lib/state.js` rather than taking this on faith:
the design decision behind this was recorded as "compare-and-swap on a
content hash", and that is still the semantic a caller sees — but plain
hash-compare-then-write turned out not to be atomic on its own. Two
concurrent claims each reported success in 5 of 5 measured trials before the
fix. The compare and the write now happen inside an exclusive `O_EXCL` lock
(`withTasksLock`/`writeTasksCas`), with an unforgeable ownership token and a
re-check of that ownership immediately before the write lands — so a holder
whose lock gets stolen (e.g. after a stale-lock breaker fires on a dead
process) never writes, even though it was nominally still "inside". From the
CLI's outside view nothing changed (still "claim, or exit 1 and retry"); the
fix was entirely in making the write safe under real concurrency.

