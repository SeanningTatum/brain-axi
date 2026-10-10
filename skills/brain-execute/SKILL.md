---
name: brain-execute
description: "implementing an approved plan / working a feature to shipped"
---
EXECUTION LOOP PLAYBOOK
========================

You are implementing an approved plan or working a feature toward shipped —
either alone, coding every slice yourself in one session, or as a
coordinator/worker fan-out: one coordinator seeds task-sized slices from the
approved plan, and one or more workers each claim, work, and close exactly
one slice. Either way, the code is GRADED by an independent verifier, never
by the agent that wrote it. This playbook is the loop that keeps that work
checkable at every step instead of becoming a single unverifiable claim at
the end ("I built it and it works"). Four rules underlie everything below:

- **Two-layer state.** `runs/progress.md` is a rolling CURSOR — one short
  checkpoint per session, just enough for the next session (or the next
  agent) to reorient. `features/<slug>/runs/<name>.md` is DEEP state — the
  verbatim step-by-step record of what you actually ran and observed. Do not
  put verbatim command output in progress.md, and do not rely on memory
  instead of writing it to the run note — if it is not written down, the
  next poll of this session (or a fresh session) cannot see it. HOW to write
  either one is `brain playbook write` — slots per artifact, and the register
  that keeps a record scannable months later.
- **Evidence strings are sourced from real command output, never invented.**
  Every `--observed` value, every `--evidence` string, is something you
  actually ran and read back — a test runner's summary line, a screenshot
  diff, a verdict doc's own Verdict line. Writing what you expect to be true
  instead of what a command told you is exactly the failure mode this whole
  loop exists to prevent.
- **Evidence is re-executed, not read.** A report that a test passed, a bug
  is fixed, or code was "reused" is a CLAIM, not a fact, whether it comes from
  a worker to a coordinator or from you to yourself three steps later. See
  EVIDENCE DISCIPLINE below before you accept one.
- **The author never grades its own work.** An agent reviewing code it just
  wrote reliably talks itself into a pass — it knows what it meant, so it
  sees what it meant. Verification goes to an agent with fresh context. See
  AGENT TOPOLOGY for who that is and the one narrow exception.

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

-------------------------------------------------------------------------------
THE LOOP
-------------------------------------------------------------------------------

1. **`brain features set-status <slug> --status in-progress`** — coordinator
   claims the feature. This enforces the one-in-progress policy: if another
   feature is already in-progress, flip it to shipped/blocked/cut first (or
   pick a different feature).

   Then open the dashboard for the human: **`brain watch <slug>`** (or pass
   `--no-open` and print its URL). It shows feature status, harness health,
   checkpoints, run-step logs, verification verdicts, screenshots, and PR
   state — live, as every command below writes state. The human watches
   execution there instead of asking you for progress reports.

   If the approved plan has more than one phase, seed it as tasks now:
   `brain tasks add <slug> --title "..." --acceptance "..." --verify "..."`
   once per phase (`--depends-on` for sequencing, `--files` for the files
   it owns) — AFTER step 1b agrees the `--verify` lines. Skip tasks for a
   single-phase feature worked solo — tasks exist to survive a handoff, not
   to formalize a to-do list of one — but never skip step 1b.

1b. **CONTRACT — agree how success is checked, before any code.** The
   implementer proposes, per task (or per phase when there are no tasks),
   what it will build and a `--verify` line: the concrete thing a verifier
   will DO to check it ("drive /settings, toggle dark mode, reload — the
   choice persists"; "`npm test -- session` passes, including a new case for
   expiry"). The verifier (fresh context, see AGENT TOPOLOGY) reviews each
   acceptance + verify pair for testability and REJECTS the vague ones —
   "works well", "is fast", "handles errors gracefully" name a hope, not an
   observation. Iterate until every pair is one the verifier could fail.
   Then record it:
   `brain runs append <slug> --step "contract agreed" --observed "<task ids
   + verify lines>"`. The verifier grades against THIS contract in step 4 —
   first sight of the acceptance criteria after the build is too late to
   push back on them.

2. **Worker: `brain brief <slug> <task-id>`, then `brain tasks claim <slug>
   <task-id> --owner <name>`.** The brief is the specification — read it
   before reading anything else about the task, including any prose the
   coordinator pasted into your prompt. If the claim is refused, see THE CAS
   CONFLICT PATH above; never skip straight to editing files.

3. **Per step, `brain runs append <slug> --step "..." --observed "..."
   [--task <id>] [--author <name>]`** — after each meaningful unit of work
   (ran the tests, drove a migration, fixed a bug, hit a dead end), append a
   step with the VERBATIM observed output. This is what makes
   `features/<slug>/runs/<name>.md` a real record instead of a summary you
   wrote from memory. Small, frequent steps beat one giant step at the end —
   if the session gets interrupted, the run note is what a fresh session (or
   the coordinator) reads to pick up exactly where you left off.

3b. **On every visual test, pass AND fail —
   `brain shots add <img> --feature <slug> --step NN-name`** (or
   `E1-name` for an error-path capture). Screenshot the failure too, not
   just the success: a failing screenshot is often the single most useful
   artifact for whoever looks at this next, and "it failed, I didn't capture
   it" is not evidence of anything.
   How to capture: brain-axi ships no browser automation by design — scaffold
   a throwaway Playwright script yourself (project-pinned playwright if the
   repo has one, else `npx -y playwright install chromium` once; script in a
   gitignored project tmp/ path, never /tmp; delete it after). The verify
   playbook (`npx -y brain-axi playbook verify`) has the full script
   pattern — the same driver serves mid-execution captures and the final
   verification walk.

3c. **On every prompt or model change, `brain evals run <suite>` and record
   the per-case delta** — `brain runs append <slug> --step "prompt: <the one
   change>" --observed "<real before/after numbers, including any frozen case
   that flipped>"`. This is the AI analogue of step 3's rule, and it carries
   one extra clause: a frozen regression case that flips to failing kills the
   change outright, whatever the aggregate did. Aggregate-only reporting hides
   a change that fixed four cases and broke two. Full loop:
   `brain playbook ai` section 5.

4. **Once the feature is demonstrably working end to end, hand it to the
   independent verifier.** Spawn the fresh-context Verifier (AGENT TOPOLOGY)
   with the contract from step 1b and `npx -y brain-axi playbook verify` —
   not with your account of what you built. It produces the verification
   doc: every contract row graded, golden path + at least one error path +
   edge probes — driven in a real browser for what a browser can reach, each
   non-browser criterion run as its named command — screenshots (or command
   + exit code + output) named to match, quality scores against their
   floors, an `- **Independence**:` line, a Verdict line. This is the step that turns "I tested it" into something
   someone else checked — and the thing `brain ship`'s strict gate (and
   gated autoship, below) actually requires.

4b. **THE FIX LOOP — on FAIL, refine or pivot, then re-grade fresh.** A FAIL
   is the loop working, not a dead end. Per round:
   - Read the failing rows — the verifier's feedback is the spec for the fix.
   - Decide, and record the decision BEFORE touching code:
     `brain runs append <slug> --step "round N: refine|pivot — <why>"
     --observed "<failing rows>"`. **Refine** when the rows are trending
     toward pass (fewer failures, narrower each round). **Pivot** to a
     different approach when the same rows fail again or the fix keeps
     widening — polishing a direction that is not converging burns rounds.
   - Fix, then a NEW fresh-context verifier re-runs the whole contract in a
     new doc, `verifications/<YYYY-MM-DD>-rN.md` with `- **Round**: N`
     (one Verdict per doc; never an addendum to the earlier round) — never
     the round-1 verifier re-reading its own notes, and never you.
   - **Cap: 3 rounds.** Still failing after round 3? Stop and escalate to the
     human with the remaining failing rows, what each round tried, and the
     refine/pivot record. A fourth silent round is a decision they did not
     get to make.

5. **Close, then ship.**
   - **Worker: `brain tasks done <slug> <task-id> --evidence "..."`** once
     the task's acceptance criteria is demonstrably met. `--evidence` is
     required (mirrors `brain ship`'s gate) and must be real observed
     output, never a summary written from memory.

     **GATED AUTOSHIP.** Closing the LAST open/claimed task on a feature
     automatically attempts `brain ship`'s IDENTICAL strict preflight. On a
     feature with a PASS verification bound to an ancestor-of-HEAD commit, it
     ships. Otherwise it refuses — reported together with the task close, in
     one result, still exit 0: the task closing is the operation this command
     primarily performs and it already succeeded; the ship declining is the
     gate working as designed, not a failure of this command. Nothing is
     written by a refused ship — `feature_list.json` stays byte-identical.
     Pass `--no-autoship` to skip the attempt entirely (e.g. the coordinator
     still has other verification work to do before shipping).
   - **Coordinator: `brain ship <slug> --evidence "..."`** — the explicit
     path, used for a solo feature or whenever autoship declined and the gap
     it named has since been closed. Requires non-empty `--evidence`
     (refuses otherwise); no-ops cleanly if already shipped; sets status
     shipped + evidence; warns (does not block) if the feature has zero
     screenshots; records a `brain progress add` checkpoint; then runs
     `brain check` and reports any invariant failure honestly — the status
     change is NOT rolled back on a check failure, because the ship itself
     already happened.

6. **Record the PR: `brain pr <slug> --url <url>`** — coordinator, after
   `gh pr create` (or however the PR gets opened), records its URL. This
   flips the dashboard to its PR-opened terminal state and checkpoints it —
   the loop's visible endpoint: approval → execution → PR. Re-running
   overwrites (fine for a force-pushed replacement PR).

-------------------------------------------------------------------------------
EVIDENCE DISCIPLINE — RE-EXECUTE, DON'T READ
-------------------------------------------------------------------------------

Three real failures from one session of running this exact loop, kept here
because a description of the failure mode is easy to nod along with and easy
to repeat anyway:

- A worker's summary said it "reused" an existing definition. The diff
  showed it had COPIED the definition instead — twice, in the same session,
  once for a field list and once for a commit-hash pattern. Reading a
  summary cannot tell "reused" from "copied"; only the diff can, because the
  distinction IS the diff.
- A worker's test simulated a concurrency bug SEQUENTIALLY and passed
  against code later measured to fail 5-of-5 under genuine concurrency. A
  test that reproduces a bug's shape but not its timing has proven nothing
  about the timing-dependent bug it claims to cover.
- A commit message asserted a specific behavior ("an age-based breaker for a
  SIGKILLed holder") that no assertion in the diff actually covered. Prose
  in a commit message is a claim about evidence, not evidence.

One root cause underlies all three: a report was READ and believed instead
of RE-EXECUTED and checked. So, whichever role you are in:

- **"I reused X"** → diff it against the thing it claims to reuse. A copy
  reads identically to a reuse in prose and never in a diff.
- **"this reproduces bug Y"** → check whether the test's actual mechanism
  can trigger Y's failure mode. A sequential test cannot prove a race is
  fixed; run it concurrently, or don't claim the race is covered.
- **"this commit does Z"** → find the assertion that fails when Z is false.
  No such assertion means no such claim — either add one or say plainly that
  Z is unverified.
- Accepting a worker's `--evidence`, or your own, is never "the summary
  sounded right" — it is re-running the command whose output is being
  quoted and reading THAT output.

-------------------------------------------------------------------------------
ONGOING
-------------------------------------------------------------------------------

- **`brain check`** — run it any time you want a deterministic read on
  harness health (feature_list.json validity, the one-in-progress policy,
  every feature doc resolving, dependency refs, plan/review file integrity,
  verification docs having a Verdict line, `tasks.json` schema validity, no
  `shipped` feature with an open task). Exit 1 on any failing check — usable
  as a CI gate, and worth running before you claim anything is done.
- If a review session is open for this feature's plan, the chrome sidebar's
  Execution section mirrors this same state (feature status + evidence,
  `brain check` health, latest checkpoints, verifications, screenshots)
  live as you work — you do not need to narrate progress in chat separately
  from what these commands already persist.
- If you are also polling that review session (`brain review poll`), each
  returned prompt carries `line` + `text` anchors resolved against the plan
  artifact's current content — apply edits via targeted reads/anchored
  replacements at that line, not a full re-read of the artifact.
- Every command above supports `--help`; every result carries a `help:`
  line pointing at the next command in this loop.
