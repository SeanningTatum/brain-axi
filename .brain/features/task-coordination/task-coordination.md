# Feature: task-coordination — a unit of work below the feature

_Last updated: 2026-08-06_

## Purpose

Give brain-axi a work unit **between** the feature and the checkpoint, so that a coordinator agent
handing phases to sub-agents does not become the only place the phase list exists. Today the phase
list lives in the plan artifact's prose and in the coordinator's context window — and a context
window does not survive compaction, a session end, or a handoff to a different agent.

The through-line: the harness models **what** is being built (features) and **where things stand**
(checkpoints), but not **who is doing which slice right now**. That third question is the one a
fan-out has to answer, and no command answers it.

## When it's used

Any time a plan is approved with more than one phase, and any time work is split across agents. In
practice that is most non-trivial features in this repo and in every repo that installs brain-axi.

## The evidence it exists for

| # | Observation | Source (all re-runnable) |
|---|-------------|--------------------------|
| 1 | `state-integrity` ran **7 phases** whose only record is CHANGELOG prose + 8 scattered checkpoint mentions. No command answers "which phases exist and which are done" | `grep "state-integrity phase" .brain/CHANGELOG.md`; `grep -c state-integrity .brain/runs/progress.md` |
| 2 | The tracker and the latest checkpoint contradicted each other for days — checkpoint said "in-progress feature: none" while `feature_list.json` held `feat-008` at `in-progress` with empty evidence — and `brain check` reported 16/16 either way, because a checkpoint is prose | `git show bbab2cc:.brain/runs/progress.md`; the 2026-08-06 close of feat-008 |
| 3 | The harness has never modelled handoff at all | `brain search "delegate"` → 0 matches; `brain search "coordinator"` → 1 unrelated hit |
| 4 | Parallel agents already happen and land unattributed: "Three runs, dispatched in parallel, each driving the app with its own script" — all three in one prose doc, because `runs append` has no author | `features/planning-ux/verifications/2026-07-30.md:49`; `brain runs append --help` |

## Design of record

Approved in plan `task-coordination` round 1 (2026-08-06, all 9 decision cards at the recommended
option, tier **complete** = phases 1–4). Snapshot frozen at `plans/task-coordination/v1.html`.

| Decision | Answer |
|---|---|
| Can a fresh agent ask the CLI which phase is next? | Yes — phases become tracked tasks |
| Two agents holding work at once? | Yes, at task level; `one_in_progress_at_a_time` stays in force for features |
| Evidence to close a task? | Required, refuses without it — same rule as `brain ship` |
| Where does the record live? | `features/<slug>/tasks.json`, one file per feature — keeps parallel writers off `feature_list.json`, the file every command reads |
| Race-safe claiming? | Compare-and-swap on a content hash; the loser gets exit 1 and a `help:` line telling it to re-list and retry |
| `brain check` gating? | Two rows — task schema always, no-shipped-feature-with-an-open-task always; an absent `tasks.json` passes (read-compat) |
| `brain brief` contents? | Composed from existing structured state: task + acceptance + approved decision prompts from `reviews.jsonl` + the rules owning the touched files |
| Claim held by a dead worker? | Surfaced with `claimed_at` + elapsed; explicit `brain tasks release`. No TTL — any TTL is wrong for some task |
| Task dependencies? | Optional `depends_on` with cycle detection; the coordinator decides phasing, so sequential work must be expressible |
| Branch/worktree on a claim? | Declined. Owner + `claimed_at` only |
| Autoship on the last task? | Yes, **gated** — runs the identical strict preflight, so it refuses without a PASS verification bound to an ancestor commit; `--no-autoship` opts out |
| Commit receipt on task evidence? | Yes — same ancestor-of-HEAD rule as a verification verdict, reusing `gitCommit`/`gitCommitExists` |

## Non-goals

- **Spawning agents.** brain-axi will not launch, schedule, or supervise a sub-agent. The harness
  (Claude Code, Codex, opencode) owns spawning; brain holds the state agents coordinate *through*.
  A CLI that shelled out to an agent runner would bind this tool to one vendor.
- **Relaxing `policy.one_in_progress_at_a_time`.** Features stay strictly serial
  (`bin/brain.js:785`). Parallelism arrives one level down, inside the single in-progress feature.
- **Parsing phases out of plan HTML.** An HTML scrape would silently mis-seed on any markup drift,
  and a wrong task list is worse than none. The coordinator types the tasks; the approved
  *decisions* are read from `reviews.jsonl`, which is already structured.

## Success metric

Tier 2, countable proxy. **Baseline (measured 2026-08-06):** answering "which phases of
state-integrity exist, which are done, and is the feature closeable" took 7 CHANGELOG rows + 8
`progress.md` mentions + `git log` + a feature-doc read, and the harness itself gave the wrong
answer (`check` 16/16 while the tracker and the latest checkpoint disagreed). **Target:** one
command — `brain tasks <slug>` — answers all three, and `brain check` emits a *failing* row when a
feature is `shipped` with an open task. **Observed by:** running both at the next multi-phase
feature's close.

## Constraints this must obey

Inherited from `rules/state.md`, which this feature extends rather than rebuilds — a task record
that ignored them would reintroduce the exact class of defect `feat-008` just closed:

- One definition per invariant, in `lib/state.js`. No re-declaration in `bin/`.
- Validators return `null` when valid, else **one** precise message naming the exact bad field
  (`tasks[2].status`) with the index included. Never throw, never `process.exit`.
- All durable writes through `writeFileAtomic` (temp + `renameSync`). Note that atomic is not the
  same as safe under concurrency — hence compare-and-swap.
- Read-compat, write-new: a brain with no `tasks.json` keeps passing every check.
- Zero dependencies, no build step, no schema library.
- stdout stays TOON-only; every result ends in a `help:` list naming the next command.

## Phases

1. **The record** — schema + `depends_on` + cycle detection + CAS write in `lib/state.js`;
   `brain tasks` (list / add / claim / done / release); task receipts.
2. **The gate** — two `brain check` rows; ship + `set-status shipped` preflight refusing on an open
   task; gated autoship with `--no-autoship`.
3. **The handoff** — `brain brief <slug> <task-id>`; `runs append --task --author`.
4. **Teach it** — `execute` playbook rewritten as a coordinator/worker loop with the topology table;
   `skillContent()` updated; `rules/state.md` + `rules/cli-commands.md` updated; skill regenerated.

Phases 5 (a tasks panel in `brain watch`) and 6 (task lifecycle events into `runs/gates.jsonl` for
`brain metrics`) are the **gold** tier and are deferred, not cut. Phase 5 is a screen — picking it
up owes a `brain playbook ux` round for wireframes and screen states first.

## Related

- Plan: `plans/task-coordination/` (reviewed, round 1) — decisions of record live in `reviews.jsonl`
- Depends on: `core-cli`, `state-integrity` (the schema, atomic-write, and receipt machinery it reuses)
- Adjacent, not overlapping: `annotation-watch` (feat-004, planned) — post-ship feedback runner
