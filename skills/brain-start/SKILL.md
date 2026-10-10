---
name: brain-start
description: "Use when starting any non-trivial task, bug fix, or feature in a repo with .brain/ — before editing code: read brain state, frame intent and scope, check policy, run the baseline, claim the feature and open a checkpoint."
---
TASK KICKOFF PLAYBOOK
=====================

You are about to start a non-trivial task in a repo with a `.brain/` harness.
This is the bookend that opens state before you touch anything — read what
the brain already knows, frame what you're about to do, and open the state
that lets the next session (or the next poll of this one) pick up where you
left off. Follow the seven steps below in order; do not start editing before
step 7's readiness statement.

Two principles carry over from the execution loop (the `brain-execute` skill (`brain playbook execute` if skills are unavailable))
because they govern reading state exactly the way that one governs writing
it:

- **Two-layer state.** `runs/progress.md` is the rolling CURSOR — read it
  first for where the last session left off. `features/<slug>/runs/<name>.md`
  is DEEP state — read it when you're picking up a feature already in flight,
  not just the cursor's one-line summary of it.
- **Retrieval over recall.** Every step below is a real command, not a memory
  of what this repo tends to look like. Training data does not reflect this
  repo's actual state — the brain does.

-------------------------------------------------------------------------------
1. READ BRAIN STATE
-------------------------------------------------------------------------------

Reorient before acting — three commands, in this order:

- `brain` (bare, no subcommand) — the home dashboard: feature counts, the
  current in-progress feature (if any), the last checkpoint, any open review
  sessions.
- `brain features` — the full status tracker, one row per feature.
- `brain progress` — the latest checkpoint in full: branch, what happened, and
  what the last session said to do next.

Do not skip this because the task "sounds simple." A few seconds reading
three commands is cheap; building on a stale assumption about feature state
or what the last session actually finished is not.

-------------------------------------------------------------------------------
2. FRAME THE TASK
-------------------------------------------------------------------------------

Answer these three, in one sentence each:

- **Intent** — what is actually being asked, not the literal wording.
- **Scope** — one of: code / brain / both.
- **Affected feature slug(s)** — cross-check against the `brain features`
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
the `brain-product` skill (`brain playbook product` if skills are unavailable) and belongs in the plan artifact, not in kickoff.
The point of doing it now is that a task you cannot frame this way is a task
whose "done" nobody can check.

-------------------------------------------------------------------------------
3. READ THE RELEVANT DOCS
-------------------------------------------------------------------------------

For whatever layer you named in step 2's scope:

- `brain docs <section>` — list the docs in a section (`rules`, `recipes`,
  `codebase`, `high-level-architecture`, ...); `brain docs view
  <section>/<name>` (add `--full` for the complete body) to read one.
- `brain search "<query>"` (optionally `--section <section>`) — find text
  anywhere in the brain when you don't know which doc has it.

Do not rely on training data for this project's own patterns and
conventions — the brain's rules/codebase docs are the source of truth for
"how this repo actually does it," and they can (and do) diverge from what a
generic project of this shape would look like.

**If this task touches prompts, models, or agents**, read
the `brain-ai` skill (`brain playbook ai` if skills are unavailable) now as well, and run `brain evals` — the suites, their
case counts, their last score, and whether any is stale or regressed — the
same way you just read the feature tracker. A prompt change made without knowing which
suite measures it — and what that suite last scored — is the AI equivalent of
editing code with the tests hidden.

-------------------------------------------------------------------------------
4. SCOPE POLICY CHECK
-------------------------------------------------------------------------------

`brain check` — run it and look at the one-in-progress-at-a-time row along
with everything else. If it's failing because another feature is already
in-progress and you're about to claim one, resolve that FIRST:

    brain features set-status <other-slug> --status blocked   # or shipped / cut

Only claim a new feature once the policy check is clean. Every other failing
check row is also worth fixing before you add to the pile, not just the
in-progress one.

-------------------------------------------------------------------------------
5. ESTABLISH BASELINE
-------------------------------------------------------------------------------

    brain verify --stage baseline

MUST pass before you make a single edit. This is what lets you tell your own
changes apart from something that was already broken: a pre-existing failure
here gets NOTED, not silently folded into your diff as if you caused it or
fixed it.

Fresh clone (verify.json checks never ran here before)? Run
`brain verify --stage bootstrap` first — it's the one-time setup stage
(installs, migrations, whatever the project's own checks need before
`baseline`/`verify` can run at all).

AI work needs a SECOND baseline: `brain evals run <suite>` for the suite that
measures the prompt you are about to touch, before you edit anything.
Same logic as above — without a pre-change score, "it seems better now" is
unfalsifiable, and a pre-existing failure gets silently folded into your diff.
See `brain playbook ai` section 5.

-------------------------------------------------------------------------------
6. CLAIM + OPEN STATE
-------------------------------------------------------------------------------

- Working a tracked feature: `brain features set-status <slug> --status
  in-progress` — claims it, enforcing the one-in-progress policy from step 4.
- Always: `brain progress add --summary "<what you're starting>"` — opens the
  rolling cursor entry for this session.
- As you work: per-step evidence goes to `brain runs append <slug> --step
  "..." --observed "..."` — that loop belongs to the execution playbook
  (`brain playbook execute`), not this one; this playbook's job ends once
  state is open, that one's begins.

-------------------------------------------------------------------------------
7. READINESS STATEMENT
-------------------------------------------------------------------------------

Before writing a line of code, state one line:

    Task: <intent from step 2> · Feature(s): <slug(s) or none> ·
    Baseline: <exit code / result from step 5>

Only after this line — and no user redirect in response to it — start
working.

**If the next act is a plan, that is not code.** Run the `brain-grill` skill (`brain playbook grill` if skills are unavailable)
before the `brain-plan` skill (`brain playbook plan` if skills are unavailable): it interviews the human while the design can
still change, and checks the brain for an already-settled answer before asking
anything. Skip it only for a change with nothing to decide.

-------------------------------------------------------------------------------
DEFINITION OF READY
-------------------------------------------------------------------------------

- [ ] Brain state read (home, features, progress) — not skimmed from memory
- [ ] Task framed: intent, scope, affected feature(s) — or a clarifying
      question was asked instead
- [ ] User-facing work only: product framing said (§2b) — the specific user
      and the observable difference that means it worked — or explicitly
      marked N/A because nothing observable changes
- [ ] Relevant docs read via `brain docs` / `brain search`
- [ ] `brain check` clean on the one-in-progress policy (and ideally
      everything else)
- [ ] Baseline established (`brain verify --stage baseline`, or `bootstrap`
      first on a fresh clone) — pass/fail recorded, not assumed
- [ ] Feature claimed (`features set-status ... in-progress`) if applicable
- [ ] `progress add` checkpoint opened
- [ ] Readiness statement said

Anything unchecked means you are not ready to start — go back and do that
step, don't skip straight to editing.

## Next

- Plan needed (the change carries a decision): use the `brain-grill` skill, then `brain-plan`.
- No plan needed (the shape is settled): use the `brain-execute` skill.
