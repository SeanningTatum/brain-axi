---
name: brain-grill
description: "Use before writing any plan, proposal, or design that carries a decision — when the user says 'let's design/plan X' or 'how should we…'. Checks the brain for already-settled answers, then interviews the human in numbered rounds with recommendations."
---
> CLI note: examples below say `brain <cmd>`. If `brain` is not on PATH, run `npx -y brain-axi <cmd>` instead.

GRILLING PLAYBOOK
=================

You are about to write a plan and you do not yet know enough to write a good
one. This playbook is the interview that runs BEFORE the artifact exists.
the `brain-plan` skill (`brain playbook plan` if skills are unavailable) writes the thing; this one works out what the thing
should be. Run it whenever the plan you are about to write will carry a
decision card — which is nearly always, and the exception is the change so
small it has nothing to decide.

Three rules govern the whole session:

- **Facts are your job. Decisions are the human's.** If a question can be
  settled by reading the repo, running a command, or dispatching a sub-agent,
  it is not a question — go find the answer. Put only genuine decisions to a
  person.
- **Never answer your own question.** A round with no reply is a round you
  wait on. An agent that fills in the human's side has not interviewed anyone;
  it has written the plan it was always going to write and added a transcript.
- **A settled decision is not a question.** The brain remembers. Check it
  before asking anything — section 1 is the entire difference between this and
  interviewing someone with amnesia.

-------------------------------------------------------------------------------
1. RUN THE MEMORY CHECK FIRST
-------------------------------------------------------------------------------

Before the tree, before the first round: write down every question you think
you have, then take each one to the brain.

- `brain search "<term>"` — rules, recipes, codebase docs, run notes.
- The recorded decision rounds on every past plan. `brain plans` for the
  list, then `brain plans view <slug>` per plan: prompts tagged decision carry
  the question that was asked and the choice that was made, verbatim.
- `brain features view <slug>` — a feature's description usually records the
  non-goals that answer a scope question outright.

For each hit, do NOT ask. Write one line instead:

    Q: How does the new capability get packaged?
    Already decided 2026-07-30, plan product-planning-mockups:
    "two new playbooks with thin branches in plan".
    Say so if that has changed.

The human reopens it in one word if the precedent has moved. What you must not
do is put a settled question back on the table as though it were open. An agent
that re-litigates a decision while holding the answer is worse than one that
never looked — the whole reason this repo keeps a brain is so the second
session does not repeat the first.

Report the arithmetic when you open the round: "six questions, two already
decided, four to ask" tells the human exactly what the check bought.

Two things the check often surfaces beyond an answer:

- **A house pattern.** Several plans answering similar questions the same way
  is a convention. Follow it, or say why not — do not present it as an open
  choice.
- **A question you were missing.** If every past plan carries a card you have
  not written, that is a gap in your plan, not in theirs. Add it.

-------------------------------------------------------------------------------
2. BUILD THE DESIGN TREE
-------------------------------------------------------------------------------

Every decision branches into the decisions that hang off it. Choosing where a
record lives decides what can read it, which decides what the command surface
looks like. That structure is the tree, and it is what makes rounds work: a
question whose answer depends on another still-open question cannot be asked
yet, because you would be guessing at its premise.

The **frontier** is every decision whose prerequisites are already settled —
the questions answerable NOW. Everything deeper waits.

You do not have to draw the tree. You do have to be able to say, for each
question, what it depends on — and if that turns out to be another open
question, the frontier is not where you thought it was.

-------------------------------------------------------------------------------
3. ASK THE FRONTIER — ONE ROUND
-------------------------------------------------------------------------------

Ask the whole frontier at once. Not one question at a time: a person answering
six related questions in one pass sees the shape of the thing, and answers each
one better for it.

Every question carries a recommendation. An interview that makes the human
generate the options from nothing is work you were supposed to do.

Use this shape, because it is the decision-card shape from
`brain playbook plan` section 8 — options here become radio rows there with no
rewriting, and the recommendation becomes the pre-checked one:

    Q1 — Where does the record live
    One or two sentences of context. What turns on this.
      a) Its own file per feature   (recommended) — scales, one owner
      b) A section in the existing tracker — fewer files, contention on writes
      c) In the plan artifact only — nothing new to check, invisible to the CLI

    Q2 — ...

Rules for the round:

- Number the questions. The human answers "1a, 2c, 3 — none of these".
- Two to six questions. More than six is a tree you have not pruned; the deeper
  half belongs to a later round.
- Shortlist every question you can. A question with no shortlist is still worth
  asking, but mark it — it lands in the artifact as an open question rather
  than a card.
- State what each option costs, not only what it gives. An option list where
  every entry sounds good is a list with a predetermined answer.

Then stop and wait. That is the part that makes it an interview.

-------------------------------------------------------------------------------
4. RECOMPUTE AND REPEAT
-------------------------------------------------------------------------------

Each answer settles a decision and pushes the frontier outward — questions that
were blocked become askable, and some become moot. Recompute, then ask the next
round.

Answers change the tree's shape, not only its state. An answer that invalidates
a branch deletes the questions hanging off it; say so rather than asking them
out of momentum.

Round three with no shrink in the frontier means the scope is too big to settle
in one plan. Stop and say so. Split it — `brain tasks` exists for exactly the
work that is too large to hold at once, and two plans that each converge beat
one that never does.

-------------------------------------------------------------------------------
5. HAND OFF TO THE ARTIFACT
-------------------------------------------------------------------------------

The session ends when the frontier is empty: every branch visited, nothing left
silently assumed. Do not start writing code. Write the plan.

Everything the grill produced has a slot in `brain playbook plan`:

- **Settled in the interview** — a decision card with the chosen option
  pre-selected, marked as already answered. The human confirms in one click
  rather than deciding twice.
- **Settled by the memory check** — a citation in the context section, plus the
  one-line reopen offer on the card it would otherwise have been.
- **Still open** — the open-questions section. A question with no shortlist was
  never card material.
- **A fact you had to go find** — a run-note step, so the next session does not
  go find it again.

The artifact is then reviewed as usual: `brain review <plan.html>`, then
`brain review poll` in the foreground.

-------------------------------------------------------------------------------
6. FAILURE MODES
-------------------------------------------------------------------------------

- **Every answer lands on your recommendation, every time.** Either your
  calibration is perfect or the questions arrived after the design was already
  fixed. Suspect the second. A question that could not have changed anything
  was decoration.
- **The human goes quiet mid-round.** Stop. Unanswered questions become open
  questions in the artifact. Never infer an answer from silence.
- **You asked something you could have looked up.** Cheap to fix once caught:
  answer it yourself, say you did, move on. Expensive as a habit — it teaches
  the human that the rounds are not worth reading closely.
- **The round is a wall of prose.** Six numbered questions with lettered
  options is scannable. Six paragraphs is a document, and it gets skimmed.

## Next

- Settled answers in hand: use the `brain-plan` skill to write the artifact.
