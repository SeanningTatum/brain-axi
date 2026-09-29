# Rule 7 — state (`lib/state.js`)

The brain's **state contract**: the feature-list schema, the single verdict parser, and the atomic
write path. Shared by `bin/brain.js` and `lib/review/brain-data.js`, which is why it sits at
`lib/state.js` rather than inside either one.

Layer position: `state` has **no dependencies on other layers**. `cli-commands` and `review-server`
both depend on it. It must never import from `lib/review/`.

## Do

- **One definition per invariant.** `STATUSES`, `FEATURE_FIELDS`, `REQUIRED_FEATURE_FIELDS`,
  `featureListPath`, `parseVerdict` live here and are imported. Re-declaring any of them elsewhere
  is the bug this module was created to fix — `brainCheck` and `features set-status` used to
  disagree about the one-in-progress policy, and two verdict parsers disagreed about the same file.
- **Validators return `null` when valid, else ONE precise message naming the exact bad field.**
  Same contract as `validateVerifyShape` (`bin/brain.js`) and `validateSuiteShape`
  (`lib/review/evals.js`). A message that names the wrong field sends the next agent to the wrong
  place, so name the index too: `features[3].status`.
- **Never throw, never `process.exit`.** This module reports; callers decide. `bin/` turns a
  validation message into `opError`; `brainCheck` turns it into a failing check row.
- **All durable state writes go through `writeFileAtomic`** (temp + `renameSync`). Applies to
  anything a reader could observe mid-write: `feature_list.json`, `runs/progress.md`, and any
  whole-file read-modify-rewrite.
- **Accept both verdict forms.** `**Verdict**: ✅ PASS` and `**Verdict**: PASS` are both real and
  both mean PASS. `unknown` is a failure, not a display value.
- **The verdict token must LEAD its value, and code is not prose.** Every spoof below scored as a
  clean PASS at some point, each found by adversarial review rather than by writing the parser more
  carefully:

  | Spoof | Now |
  |---|---|
  | `**Verdict**: this is not PASS` | `unknown` — the token must lead, not merely appear |
  | ```` ``` ````-fenced example | stripped |
  | 4-space **indented** example (a code block by markdown's rules) | stripped — leading whitespace capped at 3 |
  | An **unclosed** fence followed by a verdict | everything after it stripped |
  | `**Verdict**: ✅ PASS ❌` | `conflicting` — a contradicting emoji counts wherever it sits |
  | Two *disagreeing* verdict lines | `ambiguous` — never first-wins |
  | Two *identical* verdict lines | accepted — restating a verdict in a summary is good writing |
- **Read-compat, write-new** still holds (`review-server.md`): a new required field arrives as
  `legacy`-reported first, becomes strict a release later.

## Don't

- ❌ Import anything from `lib/review/` — that inverts the dependency direction.
- ❌ Add a dependency, a build step, or a schema library. Hand-rolled validation, zero deps.
- ❌ Hoist `readJsonSafe` here. The two copies (`bin/brain.js`, `lib/review/brain-data.js`) have
  **deliberately different contracts** — one returns `{}` and `opError`s on malformed JSON, the
  other returns `null` for both. They are not duplicates.
- ❌ Silently coerce a bad shape into a valid-looking one. `(list && list.features) || []` is what
  let `{}` pass every check in the first place.
- ❌ Validate a projection by writing it first. Pass `brainCheck(brain, { list: projected })`.

## Invariants the schema enforces

| Rule | Why |
|------|-----|
| `features` must be an array | `{}`, `[]`, `"hello"`, `42` all used to pass as "feature_list.json parses" |
| `id` and `slug` unique | Two features answering to one slug makes every lookup ambiguous |
| `status` ∈ `STATUSES` | `"done"` used to be accepted and then silently ignored by every filter |
| `id`/`name`/`slug`/`doc`/`status` non-empty | Every caller does `list.features.find(...)` and trusts the result |
| `evidence` required when `status: shipped` | A shipped feature with no evidence is the exact shape of a premature "done" |
| `features/index.md` agrees with the tracker | Two answers to "is this shipped?" means whichever file a reader opens decides what they believe |
| **`--strict`:** every `shipped` feature has a PASS verification | `evidence` is free text nobody validates. Opt-in for ambient `brain check` (read-compat), **always on** at the ship gate — that is where the claim is made |
| **`--strict`:** that PASS carries a receipt whose commit is an ancestor of HEAD | A verdict with no commit is unfalsifiable; one on a branch that never landed describes code that is not what shipped |
| A receipt commit must be a hex object id | `HEAD`, a branch, or a tag resolves through git but moves, so it binds the verdict to nothing |
| Verification docs contain **no raw HTML** except the receipt | Chasing HTML constructs one at a time is unwinnable — a verdict in `<details>` renders collapsed, in `<div>` renders as literal asterisks. Removing the ambiguity beats parsing it |
| Every entry on `strict_grandfathered` is a known, already-shipped feature | Otherwise the exemption key is an off switch: new work could ship unverified by listing itself |
| `tasks.json` files parse (`validateTasksShape`) | Same class of bug as the feature schema, one layer down — a malformed task record breaks every command that reads it |
| No `shipped` feature has an open task | A feature can't be "done" while a task under it is still `open`/`claimed`/`blocked` — same shape as shipped-without-evidence, scoped to the task layer |

## Tasks — a unit of work below the feature (`features/<slug>/tasks.json`)

Same shared-module discipline as the feature schema above, one layer down: **one definition of the
shape, in `lib/state.js`**, imported by both `bin/brain.js` (`cmdTasks*`, `cmdBrief`) and
`lib/review/brain-data.js` (`brainCheck`'s two task rows). A task record re-declared or re-validated
in either caller is the exact bug this module exists to prevent, recurring one layer down.

- **`TASK_STATUSES`** = `open | claimed | done | blocked | cut` — `open` plays the role `planned`
  plays for a feature; `claimed` is `in-progress` held by exactly one `owner`. Tasks are allowed to
  run in parallel (`policy.one_in_progress_at_a_time` is a **feature-level** policy only — many tasks
  under one in-progress feature may be `claimed` at once).
- **`validateTasksShape(data, slug)`** — same contract as `validateFeatureListShape`: `null` when
  valid, else one precise message naming the exact bad field with its index (`tasks[2].status`).
  `acceptance` is required from creation, not just at close — a task with no checkable definition of
  done is the feature-level evidence rule's failure mode, one level further down. `evidence` is
  required when `status: done`; `owner` + `claimed_at` are required when `status: claimed` (an
  unrecoverable claim — nothing to show, nothing for `tasks release` to release). A `receipt`, when
  present, requires a `commit` that is a hex object id — the same `RECEIPT_COMMIT_RE` a verification
  receipt uses, not a second regex that could drift from it.
- **Cycle detection (`findDependsOnCycle`)** — iterative DFS with an explicit stack, not recursion, so
  an unbounded `depends_on` chain can't blow the call stack. A cyclic file makes `unblockedTasks`
  return `[]` rather than guess at a partial ordering — a wrong "what's next" answer is worse than a
  refusal to answer.
- **Read-compat, write-new holds here too.** A feature with no `tasks.json` at all passes every
  check — both new `brain check` rows report "N tasks.json file(s) checked" over the ones that exist,
  never failing on absence.

### The claim lock — why a CAS write needed more than a hash compare

`writeTasksCas`/`withTasksLock` (`lib/state.js`) is the one place in this codebase that takes a real
lock, and it exists because **a hash comparison followed by a write is not itself atomic.** The
original design (recorded in the approved plan as "compare-and-swap on a content hash") read the
current file, compared its hash to the caller's expected hash, and wrote if they matched — three
separate steps, with no exclusion between them. Measured, not theorised: two concurrent `brain tasks
claim` runs each reported success in 5 of 5 trials, and one claim was silently discarded — precisely
the failure the CAS decision existed to prevent.

The fix wraps the compare-and-write in an `O_EXCL` lock file (`tasks.json.lock`) with two rules that
are **both load-bearing** — an earlier version had neither, and adversarial review broke it in three
moves (a holder's section overran a stale threshold; a second holder judged the lock stale and took
it; the first holder's `finally` then unlinked the second holder's LIVE lock by path, letting a third
holder in while the second was still inside):

1. **A holder owns an unforgeable token** (`pid:random-hex`) written into the lock file, and releases
   only a lock whose content still matches its own token — never unlinks by path alone.
2. **A holder re-checks it still owns the lock immediately before writing**, and refuses to write if
   it does not. A holder whose lock was stolen out from under it therefore never writes — the thief
   wins, the victim gets a refusal, the caller retries. Never two winners, even when two processes are
   nominally "inside" the critical section at once.

A stale lock (holder SIGKILLed mid-section) is broken by age, not by identity: `LOCK_STALE_MS` is
60s — deliberately loose, since the critical section is a handful of filesystem calls, so a minute
only ever elapses for a process that is actually dead; a tighter threshold once tripped the breaker on
a live holder inside a paused container.

**Stated honestly, not closed:** between the final ownership re-check and the rename there is a
microsecond-scale window with no fsync in it. Closing that residual needs fencing tokens and a real
lock service — not a thing a zero-dependency CLI writing JSON files gets to have. This is the same
"trust boundary, not a bug" posture as the rest of this file: the lock defends against real concurrent
writers losing each other's work, not against an adversary racing the filesystem.

## Scope is the difference between an audit and a gate

| Caller | Scope | Why |
|---|---|---|
| `brain check [--strict]` | **Whole brain** — an audit | Report every problem so the debt is visible |
| `brain ship`, `set-status --status shipped` | **`scope: <slug>`** — the feature being shipped | A gate, not an audit |

`scope` narrows **every per-feature row**: doc paths, dependency refs, verdict
readability, the raw-HTML ban, image links, and plans. It started life as
`strictScope`, covering only the two strict rows — which left the other seven
free to deadlock the gate exactly the way strict once did. One stray `<div>` in
some *other* feature's legacy verification doc, one moved screenshot, or one
malformed `plans/*/meta.json` refused **every** future ship in the repo, with a
message naming a file the shipper never touched. Fixing the strict rows and
leaving the rest was the same "hardened one path, moved the hole" mistake three
times over. `strictScope` is still accepted as a read-compat alias.

It is deliberately **not** a before/after diff of failing checks. "Did this
write make it worse?" is the right question for a *repair* path (`set-status`
de-escalation, which is why `newFailuresAfter` exists) and the wrong one for a
ship: a dangling dependency on the feature being shipped is both pre-existing
and disqualifying. The gate asks "is THIS feature fit to ship?".

## A gate over the empty set is not a pass

Once every shipped feature sits on `policy.strict_grandfathered`, the strict
rows evaluate nothing. They used to report `pass` with detail
`0 shipped feature(s) proven` — a green tick over the empty set, printed by the
very commit that promoted strict "from advisory to a gate", and echoed by the
template's `harness-check.sh` as `✓ brain check --strict passed`.

They now report **`skip`** with the outstanding debt in the detail. `skip` keeps
the exit code 0 — the debt is acknowledged, not failing — while making the
zero-coverage impossible to mistake for proof. The same holds for **`warn`** —
an advisory row (today only the strict verifier-independence row, for a
self-verified receipt) that also keeps exit 0. Consumers must treat `skip` and
`warn` as neither pass nor fail (`chrome.js`, `dashboard.js`, `brain check`'s
exit code).

The ship path shipped once with whole-brain scope, and it made the gate unusable
in both repos that own it: a single legacy feature predating the invariant refused
**every** future ship, so the only way to ship anything was to retroactively
verify everything — which nobody does, so the gate gets bypassed instead of
satisfied. Shipping X asserts that X works. It does not assert that a feature
someone shipped a year ago has a receipt.

Corollary for consuming repos — **use the ratchet, not an advisory.** An earlier
version of this rule said to wire ambient `--strict` as an advisory until the
legacy gap closed. That was half right: authoring PASS docs for flows nobody
verified is fabricating evidence, but an advisory decays into noise nobody reads.

`policy.strict_grandfathered` lists exactly the slugs that shipped before the
invariant. Strict exempts those and nothing else, so every NEW ship must prove
itself, and the list only tightens — `brain check --strict` fails if an entry
becomes fully provable (PASS **and** a resolving receipt) and is left on it, and
fails if an entry is not a known, already-shipped feature. That last check exists
because the list was otherwise an off switch: adding a slug exempted it
unconditionally.

## Verify

```bash
node scripts/check-state-invariants.mjs      # 409 assertions — schema, verdict, atomic write, brainCheck, ship, scope, tasks, CAS lock
node bin/brain.js verify --stage baseline    # runs the above plus skill-sync, harness, playbook-refs
node bin/brain.js check --brain .brain --strict   # adds shipped ⇒ PASS
```

Every case in that script is a shape that used to pass silently. Adding an invariant means adding
its synthetic case there — a validator with no failing fixture is a claim, not a check.

**And the fixture must discriminate.** That line was written in the same branch
that shipped nine rows with no fixture at all, plus four "atomic write"
assertions that pass verbatim against a plain `fs.writeFileSync` — they
described `writeFileSync`'s contract while the doc advertised them as proving
atomicity. The test for a new fixture is a **mutation**: break the thing it
names and watch it go red. The atomic-write section now asserts the two
properties that actually separate `rename(2)` from a truncating write — the
inode changes, and a reader holding the file open across the write still sees
the whole old file. (Mode preservation is asserted too, but note honestly that
it does *not* discriminate against `writeFileSync`, which also preserves mode on
an existing file; it guards a broken atomic implementation, not a naive one.)

## The trust boundary — what these gates do NOT protect against

Written down because six rounds of adversarial review kept re-finding the same
two holes, and they are not bugs. They are the boundary. Spending further rounds
"fixing" them produces theatre, not safety.

**Every state file is agent-writable.** `feature_list.json`, `runs/gates.jsonl`,
verification docs, and `policy.strict_grandfathered` are plain files in the repo.
An agent that edits them directly can mark a feature shipped, add itself to the
grandfather list, or append a gate row that never ran. The validators reject
*malformed* and *internally inconsistent* state; they cannot reject a
well-formed lie.

**The agent grades its own homework.** `brain ship` requires a PASS verification
bound to a commit — but the same agent writes the verdict. A receipt proves *when*
a claim was made about *which* code, never that anyone ran anything.

The rules below narrow that hole. They do not close it (see the verification-content section
that follows).

### What a PASS verification must contain

These are content rules, owned by `brain playbook verify` / `done`. The CLI surfaces them
(receipt fields, a `brain check --strict` **warn** row), but it cannot prove them, because every
field below is agent-written.

- **Verifier independence.** The verdict is written by a fresh-context agent that did not
  implement the change. It is declared as `- **Independence**:` in the doc header. Self-verification
  is allowed only when no second agent is possible (no sub-agent support, single-session harness),
with that reason stated; "it was faster to check it myself" is not one. An undeclared or unexplained
  self-verify is a FAIL, not a style nit. Every state-integrity review round that found a P0 or P1
  was run by a separate agent (CHANGELOG 2026-07-31 → 08-01).
- **Every acceptance row is walked.** Every acceptance criterion (the approved plan of record's
  phases plus each task's `acceptance`, with its `verify` contract line when set) is a row in the
  verification doc's `## Acceptance criteria` table, and each row gets its own observed result. A row with no result counts as a failed row, even if nothing contradicts
  it. "Spot-checked the main flow" is not a verdict on the rest.
- **Quality floors bind.** `## Quality scores` rates product-depth / functionality / design /
  code-quality from 0 to 3, with floors of 2 / 2 / 2 / 1. Any score below its floor makes the verdict
  FAIL, whatever the other rows say (design is N/A for non-UI work). A stub or display-only surface
is FAIL on product-depth.
- **The receipt names both sides.** `implemented_by` (default: the HEAD commit's git author) sits
  beside `verified_by` (default: `git config user.name`, then `$USER`). The two being equal (compared trimmed, case-insensitive)
  is a **warning**, not a refusal: `brain receipt` still stamps and adds it to its `warning:` key,
  and `brain check --strict` reports the row `every shipped feature was verified independently` as
  `warn` — never `fail`, even when the doc declares `self-verified`. Receipts stamped before
  `implemented_by` existed make that row `skip` (when nothing else is judgeable), never `fail`.
  Both defaults come from git identity, so one human stamping with defaults trips the warning; a
  sub-agent verifier shares the caller's git identity, so it must pass its own `--verified-by`. It is the visible trace
  of self-grading, and it has to be matched by the Independence reason above.

Read-compat still holds. Verification docs written before 2026-09-29 have no Independence header or
`implemented_by`, and they are not retroactively failed. The rules apply to new verdicts.

What the gates therefore actually buy:

| They do stop | They do not stop |
|---|---|
| Accidental drift, stale mirrors, unreadable verdicts | A deliberate hand-edit of state |
| Premature "done" through the CLI's own paths | An agent bypassing the CLI entirely |
| Evidence that contradicts itself | Evidence that is simply invented |
| Silent green when the tooling is absent | Someone choosing not to run the tooling |

Which is the right trade: these failures are what *actually* happens — an agent
declaring victory early, a mirror going stale, a verdict nobody can parse. A
determined forger was never the threat model, and treating it as one would mean
signing state with keys an agent must hold anyway.

The load-bearing defenses against the residual risk are **outside** this layer:
code review of the diff (state changes show up in it), CI running the gates on a
machine the agent does not control, and `git log` making a hand-edit visible.
A gate is a ratchet against carelessness, not a lock against intent.
