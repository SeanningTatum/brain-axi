# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`brain-axi` is an **AXI CLI** (`brain`) plus a **Claude Code plugin** that give coding agents durable project memory. The memory is one SQLite file, `.brain/brain.db`, in the target repo (gitignored). Agents run the CLI via shell (`brain <cmd>` or `npx -y brain-axi <cmd>`) to read and write features, tasks, checkpoints, run notes, docs, plans, verifications and declared checks. It is a tool agents use, not a library, so agent ergonomics are the product. Read the AXI standard (upstream [kunchenguid/axi](https://github.com/kunchenguid/axi); `npx skills add kunchenguid/axi`) before changing any agent-facing surface.

Node **>=24** (the brain lives in the built-in `node:sqlite` with FTS5). Zero npm dependencies, no build step, no bundler, no lint config, no third-party test framework (`node:test` only). `package.json` declares only the `brain` bin and a `files` allowlist (`bin/`, `lib/`, `skills/`, `hooks/`, `.claude-plugin/`, README, CHANGELOG) — nothing repo-dev (`scripts/`, `test/`, `evals*/`, `plans/`, `docs/`) ships to npm.

## Architecture: three layers plus the UIs

1. **`lib/brain/`: the SQLite library.** The only code that touches `brain.db`. One module per domain (`features`, `tasks`, `progress`, `runs`, `docs`, `plans`, `verifications`, `verify`, `search`, `io`), each a set of plain functions taking a `db` handle first and throwing `BrainError` (`errors.js`). `db.js` owns open/create/locate (a git worktree shares the main checkout's `.brain/`), WAL + `busy_timeout`, migrations (`migrations/NNN-*.sql`, `PRAGMA user_version`, a `.bak-vN` copy before migrating, rollback on failure, refuses a DB newer than the CLI) and `check`. `toon.js` is the TOON encoder ([toonformat.dev](https://toonformat.dev)). Entry point: `lib/brain/index.js`.
2. **`bin/brain.js`: the thin AXI.** Parse args, call one library function, print TOON with a `help:` list. 16 commands in the `COMMANDS` table: `init context export import features tasks progress runs docs plans review watch verifications verify search check`; bare `brain` is the dashboard. It never reads `.brain/` content itself and loads `lib/brain` with a dynamic `import()` **after** the Node version gate.
3. **`skills/` + plugin packaging: the method.** `skills/brain/SKILL.md` is the router; `skills/brain-<id>/` are the phase skills (start, grill, plan, product, ux, ai, execute, verify, done, write), long material in `references/`. Shipped as the Claude Code plugin via `.claude-plugin/plugin.json` + `marketplace.json` (marketplace `SeanningTatum`) and `hooks/hooks.json` (SessionStart runs `node "${CLAUDE_PLUGIN_ROOT}/bin/brain.js" context`).

**`lib/review/`** serves the two browser UIs: `brain review` (plan review with long-poll feedback) and `brain watch` (live execution dashboard). `server.js` is a loopback `node:http` server; `context.js` builds its payloads read-only from `lib/brain`; the CLI is the single writer. Static assets (`chrome.*`, `dashboard.*`, `lightbox.js`, `sdk.js`, `vendor/mermaid`) keep their wire contract. See `docs/REVIEW-ARCHITECTURE.md`.

Repo-dev only (not part of the CLI): `scripts/check-skills.mjs`, `scripts/eval-*.mjs` with suites in `evals/` and `evals-plugin/` (eval run records are history: never delete them), `plans/*.html` (approved plan artifacts, registered in the brain by path + sha256).

## Commands

```bash
node bin/brain.js                         # dashboard; every command supports --help
node --test                               # all tests (test/brain, test/cli, test/review, test/acceptance.test.js)
node scripts/check-skills.mjs             # skills tree + plugin files + skills name only real commands/flags
node bin/brain.js verify run              # this repo's declared checks (test, check-skills, harness)
node bin/brain.js check                   # integrity: SQLite, FKs, search index, cross-entity rules, file hashes
```

Verify a change by running the affected command and eyeballing the TOON on stdout, the exit code (`echo $?`), and that stderr stays diagnostics-only; then the three commands above. CI (`.github/workflows/ci.yml`, Node 24) has no `brain.db`, so it runs the zero-dep check, `node --test`, `check-skills` and a fresh-`init` smoke.

## `.brain/brain.db` is real: this repo dogfoods itself

`.brain/brain.db` is brain-axi's own live brain (features, rules, recipes, checkpoints, plans). Its rule docs are constraints on the code you write here (`node bin/brain.js docs list`, `search "<words>"`). Read and write it **through the CLI only**: never edit it with `sqlite3`, never delete or reset it. `brain export` writes a gitignored `.brain/export.toon` dump if you need a snapshot.

## Invariants to preserve

- **stdout = TOON payload only; stderr = diagnostics.** Build lines and `print()` them; never `console.log` prose. Errors also go to stdout as `error:` + `code:` + `help:`.
- **Every result ends with a `help:` list** naming the next command (AXI contextual disclosure). The dashboard (`home`) is the master guidance surface.
- **Exit codes:** 0 success (incl. no-ops), 1 operation error (`BrainError`), 2 usage error (bad args, unknown command). **Unknown flags are rejected** (exit 2) with the valid set.
- **`context` is silent and exits 0** outside a brain, without `brain.db`, on a legacy markdown brain, on any error, and on Node < 24: it runs from the SessionStart hook and must never break a session. It is capped at 600 B. Every other command on Node < 24 exits 2 with `NODE_TOO_OLD`.
- **A legacy markdown brain** (no `brain.db`) gets `LEGACY_BRAIN` (exit 1) with the pin `npx -y brain-axi@0.2.0`; `init` refuses to write over one.
- **Only `lib/brain` imports `node:sqlite` or reads `.brain/`.** New behavior goes in the library with a `node:test` case; the CLI stays thin.
- **Skills name only real commands and flags.** `check-skills` reads every command's `--help` and fails (exit 1) on a skill or reference naming a command, subcommand or flag the CLI doesn't list; the router must name every command. It also enforces frontmatter, size caps (router 6144 B, phase skills 10240 B), `## Next` handoffs, `references/` links, and plugin.json version = package.json version. Skills use `npx -y brain-axi` forms. If you add, rename or change a command, update the router and the owning `skills/brain-<id>/` in the same change.
- **New commands:** add to `COMMANDS`, give it a summary, spec and examples (its `--help` is rendered from them), return TOON ending in `help:`, add a CLI test.
- **Zero npm dependencies** (CI enforces it).
