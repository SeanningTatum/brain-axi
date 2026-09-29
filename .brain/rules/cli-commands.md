# Rule: CLI commands (bin/brain.js)

## Do

- **Register every command in `COMMANDS`** (~L2089). `main()` routes bare/`--*` → `cmdHome`, else dispatch.
- **Declare a flag spec and parse with `parseArgs`.** Unknown flags → exit 2 automatically. `--help` and `--brain` are global on every command — do not redeclare them.
- **Render help via `helpBlock`** from the same spec — one source for parsing and help.
- **Resolve the brain with `findBrain`.** Use `{optional:true}` only for hook-safe commands (`context`) that must stay silent (exit 0, no output) outside a brain repo.
- **Keep `setup` idempotent** — re-running repairs stale paths and JSON-merges into existing settings without clobbering.
- **Update `skillContent()` in the same change** whenever you add/rename a command, change a flag, or change guidance. Then run `node bin/brain.js skill --check` — it must exit 0.
- **`ship` / `set-status shipped` require `--evidence`** (non-empty). Evidence strings come from real command output — never invented.
- **`verify` runs the declared registry (`.brain/verify.json`) sequentially from the repo root.** Stages are exactly `bootstrap|baseline|verify` (default `verify`); `--only <name>` wins over `--stage`; per-check timeout defaults to 300s. Aggregate exit 1 on any fail/timeout, but the results table still prints first (cmdCheck idiom, not opError). `--feature <slug>` appends the results verbatim as a run-note step — validate the slug BEFORE running any check.
- **`init` writes prompts/warnings to stderr only** — stdout stays TOON (`created[]`/`skipped[]` + `help:`). It never clobbers: existing `.brain/` → opError; existing AGENTS.md/CLAUDE.md → skip + warn. Interactive questions only when stdin+stderr are TTYs and no deciding flag was passed.
- **`tasks` (`cmdTasks`: list/view/add/claim/done/release) is a coordination layer BELOW a feature** (`features/<slug>/tasks.json`), gated by `validateTasksShape`/`TASK_STATUSES` from `lib/state.js` — same preflight-then-commit anatomy as `cmdShip`: read → project the change → validate the projection → only then write with the hash from the read. Every mutating subcommand writes through `writeTasksCas` (compare-and-swap under an `O_EXCL` lock — see `state.md`), never a plain `writeFileAtomic`, and turns a CAS refusal into an `opError` telling the caller to re-read and retry — never a silent overwrite. `tasks done` requires non-empty `--evidence` (mirrors `ship`'s gate) and, on closing the LAST open/claimed task, attempts the identical strict ship preflight (gated autoship; `--no-autoship` opts out) — a refused autoship still leaves the task closed and reports exit 0, since the task close is this command's primary operation and already succeeded.
- **`brief` (`cmdBrief`) composes, it does not invent.** Every field in its output is read from existing structured state — the task (`tasks.json`), the approved decision prompts (`plans/<slug>/reviews.jsonl`, filtered to the round that concluded review), and the rules docs owning the task's declared `files` (derived from `rules/index.md`'s own Touches column, exposed as `rules_source` so the derivation itself is auditable). It never paraphrases a decision or invents an owning rule — a section with nothing to say still prints a definitive "none" line rather than going silently empty.
- **`receipt` records who implemented as well as who verified.** `--implemented-by` defaults to the HEAD commit's git author. When it equals `verified_by` (trimmed, case-insensitive), the receipt still stamps and says so on stdout — one `warning:` key (multiple warnings joined with `; `) plus a `help:` line — never a refusal. `brain check --strict` carries it as the row `every shipped feature was verified independently`: `warn` for a self-verified receipt (declared or not), `pass` when identities differ, `skip` when every receipt predates `implemented_by`; never `fail`, and `warn` keeps exit 0. Self-verification is sometimes legitimate, and the verification doc's `- **Independence**:` line is where the reason goes (`state.md`, "What a PASS verification must contain").
- **`tasks add --verify "<how checked>"` is the contract, not decoration.** It is the implementer's proposed check, and the verifier reviews it for testability before code is written. `brief` and `tasks view` must show it verbatim (`verify: none` when absent), never paraphrased; `--verify ""` is a usage error (exit 2). `tasks <verb> --help` prints the verb's help, not the list help.
- **`runs append` accepts `--task <id>` and `--author <name>`**, both optional and additive. `--task` is validated against `tasks.json` **when that file exists** (a typo'd id is rejected) but a feature with no `tasks.json` at all must still accept `--task` freely — read-compat holds at this layer too.

## Don't

- ❌ Add a command without a `help:` list, `--help`, or `COMMANDS` entry.
- ❌ Accept unknown flags silently.
- ❌ Let `context` error or print outside a brain repo — it runs from installed SessionStart hooks.
- ❌ Change a command surface without updating `skillContent()` (breaks `skill --check` / CI).
- ❌ Add npm deps or scripts — the CLI is zero-dep, no build.

## New-command checklist

1. Write `cmdX` following the standard anatomy (spec → parse → findBrain → work → TOON + `help:`).
2. Register in `COMMANDS`.
3. Wire `--help` via `helpBlock`.
4. Reject unknown flags (free via `parseArgs`).
5. Update `skillContent()`.
6. Verify: `node bin/brain.js x --brain .brain`, `echo $?`, `node bin/brain.js skill --check`.
