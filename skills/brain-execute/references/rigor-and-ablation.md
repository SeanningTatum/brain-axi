[brain-execute reference — rigor scaling and harness ablation]

-------------------------------------------------------------------------------
RIGOR SCALES WITH THE TASK
-------------------------------------------------------------------------------

An evaluator (a verifier, a second pass, a review gate) is worth its cost
only when the task sits beyond what the current model does reliably alone.
Checking work a model gets right every time buys nothing; skipping the check
on work it gets wrong a third of the time buys a silent defect. Tie the
amount of rigor to the plan's tier:

- **Small tier** — the declared `brain verify` checks, the contract review
  (one `--verify` line per task, step 1b), and a single fresh sub-agent
  verifier over every acceptance row. On FAIL the fix loop still runs: a
  fresh verifier per round, cap 3.
- **Full tier** (cross-layer, user-facing, or expensive to reverse) — the
  same, with an independent verifier on the whole contract -> verify -> fix
  loop, and a second adversarial pass on the riskiest tasks recommended.
- **Quality floors apply in both tiers** (design is N/A for non-UI work).

The tier changes how many verifier passes you buy, never whether the author
grades its own work. The tier line itself moves when a model improves: work
that needed the full tier last year may be small tier now.

-------------------------------------------------------------------------------
HARNESS COMPONENTS ARE BETS
-------------------------------------------------------------------------------

Every component of this loop encodes an assumption about what the model
cannot do alone:

- the session context hook (the model won't orient itself),
- the checkpoint cursor and run steps (it won't remember across sessions),
- the one-in-progress policy (it will sprawl),
- human plan review (it will plan the wrong thing),
- the contract step (it will accept vague success criteria),
- the independent verifier (it will grade its own work generously),
- the fix-loop round cap (it will polish a dead end forever),
- quality floors (it will ship passing-but-poor work),
- commit-bound verifications (a verdict can drift from the code it graded),
- declared verify checks (it will skip the cheap mechanical gates).

A component nobody has tried removing is a claim, not a finding. "Validated"
means ablated — removed for a trial, effect measured — not merely observed
catching problems. A gate that catches problems may just be catching problems
a better model would not have made.

-------------------------------------------------------------------------------
WHEN A NEW MODEL LANDS
-------------------------------------------------------------------------------

1. **Re-read traces first.** Latest run steps (`brain runs view <slug>`),
   verifications (`brain verifications list --feature <slug>`), and
   checkpoints (`brain progress list`). Find where the harness actually
   intervened: which gate failed, which verifier row flipped a result, which
   fix-loop round changed the outcome.
2. **Ablate one component at a time, weakest evidence first** — the context
   hook, plan review on small tier, the round cap. Never two at once, or you
   cannot attribute the effect.
3. **Record the outcome**, even "no measurable effect", as a checkpoint
   (`brain progress add --summary "..." --next "..."`) and, if lasting, as a
   doc: `brain docs set architecture harness-assumptions --from <file>`.
4. **Strip what isn't load-bearing, keep what is.** Put a component back only
   when a trace shows the failure it guarded against.
