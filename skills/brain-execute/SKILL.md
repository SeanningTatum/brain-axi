---
name: brain-execute
description: "Use when implementing an approved plan or working a feature to shipped — 'build it', 'go', 'start phase N'. Flip the feature in-progress, open brain watch, log every step verbatim with runs append, capture screenshots, agree the verification contract first."
---
> CLI note: examples below say `brain <cmd>`. If `brain` is not on PATH, run `npx -y brain-axi <cmd>` instead.

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
  either one is the `brain-write` skill (`brain playbook write` if skills are unavailable) — slots per artifact, and the register
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
ROLES
-------------------------------------------------------------------------------

Coordinator seeds tasks and owns `brain ship`; Worker owns one task; Verifier is independent, fresh-context, never the author (solo work collapses the first two, never the third). On a CAS refusal, never force a claim — `brain tasks <slug>`, take another. Roles, handoffs, CAS path: Read `references/agent-topology.md` (`brain playbook execute --ref agent-topology`).

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
   choice persists"; "`<the project's test command> -- session` passes, including a new case for
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
   the `brain-ai` skill (`brain playbook ai` if skills are unavailable) section 5.

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

4b. **FIX LOOP on FAIL** — record `round N: refine|pivot — <why>` via runs append BEFORE touching code; a NEW fresh verifier writes `verifications/<YYYY-MM-DD>-rN.md`; cap 3 rounds, then escalate.
5. **Close, then ship** — worker `brain tasks done <slug> <task-id> --evidence "..."` (last task attempts gated autoship); coordinator `brain ship <slug> --evidence "..."`.
6. **Record the PR** — `brain pr <slug> --url <url>`. Steps 4b-6 in full: Read `references/fix-loop-and-close.md` (`brain playbook execute --ref fix-loop-and-close`).

EVIDENCE: a report is a claim until you re-run the command whose output it quotes. Why: Read `references/evidence-discipline.md` (`brain playbook execute --ref evidence-discipline`).

-------------------------------------------------------------------------------
ONGOING
-------------------------------------------------------------------------------

- **`brain check`** — deterministic harness health; exit 1 on any failing check. Run it before you claim anything is done. More: Read `references/ongoing.md` (`brain playbook execute --ref ongoing`).

- Every command above supports `--help`; every result carries a `help:` line pointing at the next command in this loop.

## Next

- Feature demonstrably working end to end: hand it to an independent verifier with the `brain-verify` skill.
- While recording steps, checkpoints, and docs, use the `brain-write` skill.
