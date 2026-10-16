---
name: brain-write
description: "Use whenever writing anything into the brain — progress checkpoints, run notes, feature docs, verification verdicts, commit bodies. The register: specific, verbatim, dated; what never goes in."
---
> CLI note: examples below say `brain <cmd>`. If `brain` is not on PATH, run `npx -y brain-axi <cmd>` instead.

WRITTEN RECORD PLAYBOOK
=======================

One rule carries everything below: **the record is reference, not release
notes.**

Who actually reads it decides that. Not someone catching up on the project —
an agent, cold, weeks later, scanning for ONE fact: what was decided, what the
gate was, what shipped, what broke. It arrives mid-task with a specific
question and leaves as soon as it has the answer. It is not reading your
paragraph; it is looking for a line.

So: **facts go in named slots, and prose is reserved for the why that no slot
can hold.** A checkpoint written as an argument makes the reader reconstruct
the facts out of it. A checkpoint written as slots hands them over.

-------------------------------------------------------------------------------
1. THE DEFECT, CONCRETELY
-------------------------------------------------------------------------------

Real, from a template repo's progress.md:

    ## 2026-08-06 — Released v1.8.0 'Your Sub-Agents Follow You To Kimi'
    (squash 2fac879, PR #24 squash-merged). The ten .claude/agents/ operators
    now load under Kimi Code too: .kimi-code/agents is a symlink onto
    .claude/agents (git mode 120000), .gitignore shares that one path only, and
    harness-check check D2 asserts symlink identity rather than existence.
    Discovery path was read out of the kimi binary and confirmed with
    'kimi --agent <bogus>', which prints the roster at zero model cost. Greptile
    pre-PR caught a false green in D2's first draft — a dangling symlink
    compared two failed cd resolutions as equal and reported PASS; fixed in
    dce3ba2 and driven into all five states.

Five sentences, four parentheticals, two em-dash asides — all inside a heading
whose documented format is a one-line summary. Nothing here is false or padded.
It is simply shaped for reading, and it will be scanned.

Same facts, slotted:

    ## 2026-08-06 — Kimi Code loads the same sub-agents as Claude
    - what: .kimi-code/agents is a symlink to .claude/agents. Add an agent
      once, both CLIs see it.
    - why symlink, not copy: a copy passes an existence check until someone
      edits one side.
    - gate: harness-check D2 asserts symlink identity. Exercised all 5 states.
    - shipped: v1.8.0 · squash 2fac879 · PR #24
    - next: ...

About 40% of the words, and every fact is findable without reading the
neighbouring one. Note what survived: "false green" is a compact name for a
recurring thing and stays. What went is the rhythm — an aphorism per paragraph,
the load-bearing mechanism buried mid-clause.

-------------------------------------------------------------------------------
2. THE REGISTER
-------------------------------------------------------------------------------

- **Lead with the plain claim, then the mechanism.** "brain check can pass
  while the state it checks contradicts itself" before the explanation of how.
  A reader who only needs the claim stops after one line.
- **One fact per line.** Two facts joined by a semicolon are two lines. The
  reader is scanning line starts.
- **Parentheticals cost a re-read.** One per entry, at most. A parenthetical
  carrying a load-bearing fact is not a parenthetical — promote it to a slot.
- **Name the thing, don't characterize it.** "exercised all 5 states" beats
  "driven into all five states"; "refuses without evidence" beats "the
  invariant worth asserting".
- **Quote command output; never paraphrase it.** "301/301 tests, exit 0" is
  evidence. "tests pass" is a claim. This is the same rule
  the `brain-execute` skill (`brain playbook execute` if skills are unavailable) applies to every --observed string, and it applies
  to prose for the same reason.
- **Aphorisms are for the plan artifact, not the record.** A plan argues; a
  record reports. The sentence you are proud of usually belongs in the plan.

-------------------------------------------------------------------------------
3. PRUNE
-------------------------------------------------------------------------------

Three tests, applied line by line before you write it down:

- **Does the reader already assume this?** A line stating what any competent
  reader takes for granted costs tokens and attention to say nothing. Delete
  the whole line rather than shortening it.
- **Is this the only place this fact lives?** The same fact in the feature doc,
  the run note, and the checkpoint is three places to update and two to go
  stale. Put it where it belongs and link the others there.
- **Would a familiar word do?** A coined term makes the reader carry a
  definition. Reach for the ordinary word first. The exception earns its place:
  a compact name for something that recurs — a "false green", a "tight loop" —
  pays for itself by the third use.

The environment is a source of truth too. A doc that restates what
`brain features` or a config file already reports is a copy that can go stale;
cache only what the reader cannot look up.

-------------------------------------------------------------------------------
4. SLOTS PER ARTIFACT
-------------------------------------------------------------------------------

--- 4.1 CHECKPOINT (progress add) ---

The rolling cursor. One line of summary, hard — `brain progress add` refuses a
summary over 200 characters, because the file's own format has always
documented a one-line summary and prose expands to fill whatever it is given.

    --summary  <what changed, in one line — the headline, not the story>
    --next     <the single next concrete action, or the open items>

Verbatim command output does NOT belong here. It belongs in the run note.

--- 4.2 RUN-NOTE STEP (runs append) ---

The deep record. This is where verbatim output lives.

    --step      <what you were doing — a phase name, not a sentence>
    --observed  <what the command actually printed, quoted>

If --observed contains a word you wrote rather than read, it is wrong.

--- 4.3 FEATURE DOC ---

Sections are fixed by the template. Two failure modes worth naming: a Purpose
that restates the feature name, and a How It Works that narrates the diff
instead of describing the runtime. Write it for someone who will read it
BEFORE touching the code, not someone reviewing your change.

The changelog table takes one row per behaviour change: date, type, and what
changed — with the evidence, not the adjective.

--- 4.4 VERIFICATION DOC ---

Owned by the `brain-verify` skill (`brain playbook verify` if skills are unavailable); the register rules here apply to its prose.
The Verdict line is parsed by `brain check` — write it exactly as that
playbook specifies and do not editorialize on the same line. One Verdict per
doc: a re-walk after a FAIL is a new `<date>-rN.md` doc, never a second
verdict appended to the old one.

--- 4.5 COMMIT BODY ---

The most-read artifact in the repo, and the one the CLI cannot check. Nothing
gates this; it is here because the defect is identical.

    <one line: what changed and why, in the imperative>
    <blank>
    <mechanism — the part a reader could not infer from the diff>
    <blank>
    <evidence: what you ran, what it printed>

The diff already says what changed. The body is for what the diff cannot show:
why this shape, what you rejected, what would break if someone undid it.

-------------------------------------------------------------------------------
5. WHAT THIS DOES NOT COVER
-------------------------------------------------------------------------------

Plan artifacts. A plan is persuasion — it argues that a thing is worth
building, and it is read once, start to finish, by a person deciding. That is
the opposite job, and the `brain-plan` skill (`brain playbook plan` if skills are unavailable) owns it.

If you are unsure which you are writing: a record answers "what happened", a
plan answers "what should we do". Only one of them is allowed a good sentence.

## Next

- Used from the `brain-execute` skill (run notes, checkpoints) and the `brain-done` skill (close-out checkpoint, ship evidence, PR record); no successor of its own.
