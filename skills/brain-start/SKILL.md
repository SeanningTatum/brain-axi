---
name: brain-start
description: "Use when starting any non-trivial task, bug fix, or feature in a repo with .brain/ — before editing code: read brain state, frame intent and scope, check policy, run the baseline, claim the feature and open a checkpoint."
---
> CLI note: examples below say `brain <cmd>`. If `brain` is not on PATH, run `npx -y brain-axi <cmd>` instead.

TASK KICKOFF
============

You are about to start a non-trivial task in a repo with a `.brain/` harness.
This is the bookend that opens state before you touch anything — read what
the brain already knows, frame what you're about to do, and open the state
that lets the next session (or the next poll of this one) pick up where you
left off. Follow the seven steps below in order; do not start editing before
step 7's readiness statement.

Two principles govern reading state exactly the way the `brain-execute`
skill's loop governs writing it:

- **Two-layer state.** The latest checkpoint (`brain progress list`, its
  `summary:` and `next:`) is the rolling CURSOR — read it first for where the
  last session left off. The feature's run notes (`brain runs view <slug>
  --run <name>`) are DEEP state — read them when you're picking up a feature
  already in flight, not just the cursor's one-line summary of it.
- **Retrieval over recall.** Every step below is a real command, not a memory
  of what this repo tends to look like. Training data does not reflect this
  repo's actual state — the brain does.

-------------------------------------------------------------------------------
1. READ BRAIN STATE
-------------------------------------------------------------------------------

Reorient before acting — three commands, in this order:

- `brain` (bare, no subcommand) — the home dashboard. Read `features:` (the
  counts), `in-progress:` (the feature in flight, if any), `last-checkpoint:`
  and `next:`.
- `brain features list` — the full status tracker, one row per feature
  (`slug`, `status`, `tasks`, `pr`).
- `brain progress list` — recent checkpoints, newest first: `branch`,
  `feature`, `summary`, `next`, and `run` (the linked run note). If the task
  continues a feature in flight, also read `brain runs view <slug> --run <name>`
  for that `run` name — the deep layer.

Do not skip this because the task "sounds simple." A few seconds reading
three commands is cheap; building on a stale assumption about feature state
or what the last session actually finished is not.

-------------------------------------------------------------------------------
2. FRAME THE TASK
-------------------------------------------------------------------------------

Answer these three, in one sentence each:

- **Intent** — what is actually being asked, not the literal wording.
- **Scope** — one of: code / brain / both.
- **Affected feature slug(s)** — cross-check against the `brain features list`
  output from step 1, or "none" if this task doesn't touch tracked feature
  work.

If you cannot answer all three confidently, ask ONE clarifying question and
stop. Do not guess at intent or scope and proceed anyway — a wrong guess here
compounds through every later step.

--- 2b. PRODUCT FRAMING (user-facing work only) ---

Skip this entirely when nothing observable changes — an internal refactor, a
dependency bump, CI config. Otherwise add two more sentences:

- **Who** — the specific user and the job they are doing when they hit this.
  In this repo that is often the calling AGENT, not a human; an agent reading
  TOON output and deciding what to run next is a user with a job.
- **How you will know it worked** — the observable difference after this
  ships. A number if one exists, otherwise the exact command or state that
  must differ.

Two sentences here, not a brief. The full standard — problem + evidence,
success-metric fallback ladder, non-goals, scope tiers, prior art — lives in
the `brain-product` skill and belongs in the plan artifact, not in kickoff.
The point of doing it now is that a task you cannot frame this way is a task
whose "done" nobody can check.

-------------------------------------------------------------------------------
3. READ THE RELEVANT DOCS
-------------------------------------------------------------------------------

For whatever layer you named in step 2's scope:

- `brain docs list --section <section>` — list the docs in a section (`rules`,
  `recipes`, `codebase`, `architecture`, ...); `brain docs view
  <section>/<name>` (add `--full` for the complete body) to read one.
- `brain search "<query>"` (optionally `--kind doc`) — find text anywhere in
  the brain when you don't know which doc has it; read `kind`, `ref`, `snippet`.

Do not rely on training data for this project's own patterns and
conventions — the brain's rules/codebase docs are the source of truth for
"how this repo actually does it," and they can (and do) diverge from what a
generic project of this shape would look like.

**If this task touches prompts, models, or agents**, read the `brain-ai`
skill now as well: know the prompt contract and the project's golden set
before you edit a prompt, the way you just read the feature tracker.

-------------------------------------------------------------------------------
4. SCOPE POLICY CHECK
-------------------------------------------------------------------------------

`brain check` — run it and read the `checks` rows, the one-in-progress-at-a-time
row along with everything else.

**One in-progress feature at a time.** `brain features set` and `brain check`
enforce it (tasks under a feature run in parallel; features do not). If another
feature is already in-progress and you're about to claim one, resolve that
FIRST:

    brain features set <other-slug> --status blocked   # or ship / cut it properly

Only claim a new feature once the policy check is clean. Every other failing
check row is also worth fixing before you add to the pile.

**Anti-creep.** If you catch yourself thinking "while I'm here…" and touching
something unrelated to the task, stop and open a new task
(`brain tasks add <slug> --title "..."`) instead of folding it into this diff.

-------------------------------------------------------------------------------
5. ESTABLISH BASELINE
-------------------------------------------------------------------------------

Run `brain verify list` — the project's declared checks (`name`, `stages`,
`run`). If it reports no checks (or `brain verify run` exits 1 with NO_CHECKS),
declare this project's real ones first (typecheck, tests, lint, ...) — a
baseline on nothing proves nothing:

    brain verify add <name> --run "<cmd>" --stages baseline,verify

Then run:

    brain verify run --stage baseline

MUST pass before you make a single edit. This is what lets you tell your own
changes apart from something that was already broken: a pre-existing failure
here gets NOTED, not silently folded into your diff as if you caused it or
fixed it. Read the results table and the exit code (`echo $?`).

Fresh clone? If `brain verify list --stage bootstrap` lists checks, run
`brain verify run --stage bootstrap` first (one-time setup: installs,
migrations). None declared? Skip it — that run would exit NO_CHECKS.

-------------------------------------------------------------------------------
6. CLAIM + OPEN STATE
-------------------------------------------------------------------------------

- Working a tracked feature: `brain features set <slug> --status in-progress`
  — claims it, enforcing the one-in-progress policy from step 4.
- Always: `brain progress add --summary "<what you're starting>" --next "<first
  action>" [--feature <slug>]` — opens the rolling cursor entry for this
  session (summary ≤ 200 chars).
- As you work: per-step evidence goes to `brain runs append <slug> --step
  "..." --observed "..."` — that loop belongs to the `brain-execute` skill;
  this skill's job ends once state is open, that one's begins.

-------------------------------------------------------------------------------
7. READINESS STATEMENT
-------------------------------------------------------------------------------

Before writing a line of code, state one line:

    Task: <intent from step 2> · Feature(s): <slug(s) or none> ·
    Baseline: <exit code / result from step 5>

Only after this line — and no user redirect in response to it — start
working.

**If the next act is a plan, that is not code.** Run the `brain-grill` skill
before the `brain-plan` skill: it interviews the human while the design can
still change, and checks the brain for an already-settled answer before asking
anything. Skip it only for a change with nothing to decide.

-------------------------------------------------------------------------------
DEFINITION OF READY
-------------------------------------------------------------------------------

- [ ] Brain state read (home, features list, progress list; run notes if the
      feature is in flight) — not skimmed from memory
- [ ] Task framed: intent, scope, affected feature(s) — or a clarifying
      question was asked instead
- [ ] User-facing work only: product framing said (§2b) — the specific user
      and the observable difference that means it worked — or explicitly
      marked N/A because nothing observable changes
- [ ] Relevant docs read via `brain docs` / `brain search`
- [ ] `brain check` clean on the one-in-progress policy (and ideally
      everything else)
- [ ] Baseline established on REAL declared checks (`brain verify run --stage
      baseline`, or `bootstrap` first on a fresh clone) — pass/fail
      recorded, not assumed
- [ ] Feature claimed (`features set ... --status in-progress`) if applicable
- [ ] `progress add` checkpoint opened
- [ ] Readiness statement said

Anything unchecked means you are not ready to start — go back and do that
step, don't skip straight to editing.

## Next

- Plan needed (the change carries a decision): use the `brain-grill` skill, then `brain-plan`.
- No plan needed (the shape is settled): use the `brain-execute` skill.
