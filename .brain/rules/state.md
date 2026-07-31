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

Corollary for consuming repos: wire ambient `--strict` as an **advisory** until
the legacy gap is genuinely closed. Making it green by authoring PASS docs for
flows nobody verified is fabricating evidence — the exact failure the harness
exists to prevent.

## Verify

```bash
node scripts/check-state-invariants.mjs      # 124 assertions — schema, verdict, atomic write, brainCheck, ship
node bin/brain.js verify --stage baseline    # runs the above plus skill-sync, harness, playbook-refs
node bin/brain.js check --brain .brain --strict   # adds shipped ⇒ PASS
```

Every case in that script is a shape that used to pass silently. Adding an invariant means adding
its synthetic case there — a validator with no failing fixture is a claim, not a check.
