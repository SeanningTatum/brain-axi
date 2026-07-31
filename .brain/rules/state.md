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

## Verify

```bash
node scripts/check-state-invariants.mjs      # 78 assertions — schema, verdict, atomic write, brainCheck, ship
node bin/brain.js verify --stage baseline    # runs the above plus skill-sync, harness, playbook-refs
```

Every case in that script is a shape that used to pass silently. Adding an invariant means adding
its synthetic case there — a validator with no failing fixture is a claim, not a check.
