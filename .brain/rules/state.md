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

## Strict has two scopes, and mixing them up breaks the gate

| Caller | Scope | Why |
|---|---|---|
| `brain check --strict` | **Whole brain** — an audit | Report every unproven shipped feature so the debt is visible |
| `brain ship`, `set-status --status shipped` | **`strictScope: <slug>`** — the feature being shipped | A gate, not an audit |

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
node scripts/check-state-invariants.mjs      # 186 assertions — schema, verdict, atomic write, brainCheck, ship
node bin/brain.js verify --stage baseline    # runs the above plus skill-sync, harness, playbook-refs
node bin/brain.js check --brain .brain --strict   # adds shipped ⇒ PASS
```

Every case in that script is a shape that used to pass silently. Adding an invariant means adding
its synthetic case there — a validator with no failing fixture is a claim, not a check.

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
