# brain-axi

**A CLI that gives coding agents a memory.**

`brain` reads and writes one SQLite file, `.brain/brain.db`: the durable knowledge layer of a repo (features, tasks, checkpoints, run notes, rules and recipes, reviewed plans, verifications, declared checks) that survives across agent sessions. Agents shell out to it; a Claude Code plugin ships the skills that tell them when.

## Why

Every new agent session starts from zero. It re-reads the codebase, re-derives what's in progress, re-asks "what did we decide last time", and sometimes forgets a decision was ever made and re-litigates it. Context windows reset; institutional memory shouldn't.

`.brain/brain.db` is that memory and `brain` is the interface to it: one command to see feature status, one to add a checkpoint, one to search every rule and recipe you've written down. No MCP server, no daemon, no API key, no npm dependencies.

The output is [TOON](https://toonformat.dev/), not JSON or prose: small default schemas, pre-computed counts, truncated bodies with a `--full` escape hatch, definitive empty states, and a `help:` block at the end of *every* result naming the next command. The CLI's own output is how a fresh agent learns to use it.

**It's for you if** you re-brief an agent every morning on work the same agent did yesterday, you've watched one confidently redo something you ruled out, or you run more than one agent and want them working from the same state. **It's not for you if** the whole project fits in one context window.

## Install

Requires **Node 24+** (the brain is stored with the built-in `node:sqlite`).

**Claude Code plugin (recommended)**: skills plus a SessionStart hook that injects `brain context` into every session.

```sh
claude plugin marketplace add SeanningTatum/brain-axi
claude plugin install brain-axi@SeanningTatum
```

(Inside a session: `/plugin marketplace add SeanningTatum/brain-axi`, then `/plugin install brain-axi@SeanningTatum`.)

**CLI only**, any agent: `npx -y brain-axi <command>`. Or from a checkout: `git clone https://github.com/SeanningTatum/brain-axi.git && cd brain-axi && npm link`.

## Quick start

Once per repo:

```sh
npx -y brain-axi init
```

That creates `.brain/brain.db`, adds it to `.gitignore`, and seeds the first checkpoint. Then just work: ask your agent to plan, build or check on something. The plugin's skills chain the method: **`brain`** (orient and route) → **`brain-start`** → **`brain-grill`** → **`brain-plan`** (with **`brain-product`** / **`brain-ux`** / **`brain-ai`** as needed) → **`brain-execute`** → **`brain-verify`** → **`brain-done`**, with **`brain-write`** as the register for anything written into the brain. Each skill is also a slash command (`/brain-axi:brain-plan`, …).

You rarely type `brain` yourself. When you do, bare `brain` is the dashboard:

```
$ brain
brain: .brain
features: "13 total (1 planned, 1 in-progress, 9 shipped, 1 blocked, 1 cut)"
in-progress: axi-core
last-checkpoint: "2026-10-10 — axi-core phase 3 done: review + watch read brain.db via lib/brain, ..."
next: phase 4 (skills on the new surface) lands from its worktree; then phase 5 rebuilds this repo's brain
help[5]:
  Run `brain features view axi-core` for the feature in flight
  Run `brain progress list` for recent checkpoints
  Run `brain search "<query>"` to find text anywhere in the brain
  Run `brain docs list` to browse rules, recipes and architecture docs
  Run `brain --help` for every command
```

## Commands

Every command supports `--help` and a global `--brain <path>` (default: walk up from cwd; git worktrees share the main checkout's brain). Unknown flags are rejected with the valid set.

| Command | What it does |
|---|---|
| `brain init` | Create `.brain/brain.db` (gitignored) and seed the first checkpoint |
| `brain context` | Compact session-start context (≤ 600 B); silent outside a brain. Used by the SessionStart hook |
| `brain features` | The feature tracker: `list`, `view`, `add`, `set` (status, pr, fields), `ship` (needs evidence, no open tasks and a PASS verification) |
| `brain tasks` | Units of work below a feature: `list`, `view` (the brief), `add`, `claim`, `set` |
| `brain progress` | Checkpoints, the rolling where-are-we cursor: `list`, `add` (`--run` links a run note) |
| `brain runs` | Run notes, verbatim numbered steps per feature: `view`, `append` |
| `brain docs` | Markdown docs in the brain (rules, recipes, codebase, architecture, features, …): `list`, `view`, `set`, `rm` |
| `brain search "<words>"` | Full-text search (FTS5) across features, docs, checkpoints, run steps and verifications |
| `brain review` | Human review of a plan artifact in the browser: `open`, `poll`, `end` (`--approved-by` for headless) |
| `brain plans` | Reviewed plan artifacts (registered by `brain review open`): `list`, `view` |
| `brain watch <feature>` | Open the live execution dashboard for a feature |
| `brain verifications` | Verdicts bound to the commit they were taken on: `list`, `view`, `add` (`--shot` attaches screenshots) |
| `brain verify` | Declared project checks: `list`, `add`, `run` (`--stage` / `--only`). Bare `brain verify` runs them |
| `brain check` | Integrity: SQLite integrity, foreign keys, search index, cross-entity rules, plan/shot file hashes |
| `brain export` | Deterministic TOON dump of the whole brain (default `.brain/export.toon`, gitignored) |
| `brain import <file>` | Load an export into an empty brain |

**Exit codes**: `0` success (including no-ops), `1` operation error, `2` usage error. Errors print to stdout as `error:` + `code:` + `help:` lines; stdout is always the parseable payload, stderr is diagnostics only.

```
$ brain search "one in progress" --limit 1
query: one in progress
results[1]{kind,ref,title,snippet}:
  doc,features/core-cli,"Feature: Core AXI CLI","…planned|[in]-[progress]|shipped|blocked|cut`, `policy.[one]_[in]_[progress]_at_a…"
help[1]: Open a hit: brain docs view <ref>
```

## Plan review and the execution dashboard

`brain review open <plan.html>` opens an HTML plan in the browser next to a composer sidebar: round indicator, queued annotations, a message box. The agent's `brain review poll` long-poll picks up whatever is sent, so review loops without either side leaving their tool.

<img src="https://raw.githubusercontent.com/SeanningTatum/brain-axi/main/docs/assets/plan-review.png" alt="Screenshot of a brain review session: a rendered HTML plan on the left, composer sidebar with round indicator and message box on the right" width="700">

`brain watch <feature>` opens a live, read-only dashboard: status pipeline (plan approved → in-progress → run steps → verification → shipped → PR), run-step logs, checkpoints and screenshots.

<img src="https://raw.githubusercontent.com/SeanningTatum/brain-axi/main/docs/assets/execution-dashboard.png" alt="Screenshot of the brain watch execution dashboard showing a feature's status pipeline, run steps, checkpoints, and screenshot filmstrip" width="700">

Screenshots attached with `brain verifications add --shot` open in a shared in-page carousel (arrows, ←/→/Esc, captions, filmstrip). Toggle **Annotate** to drop a numbered pin with a note.

<img src="https://raw.githubusercontent.com/SeanningTatum/brain-axi/main/docs/assets/carousel-lightbox.png" alt="Screenshot of the shared lightbox carousel open over a screenshot, with arrow navigation and a filmstrip of thumbnails" width="700">

<img src="https://raw.githubusercontent.com/SeanningTatum/brain-axi/main/docs/assets/annotate-pin.png" alt="Screenshot of the lightbox in Annotate mode with a numbered pin dropped on the screenshot" width="700">

## Architecture

Three layers, each depending only on the one below:

- **Skills** (`skills/`, shipped as the `brain-axi` Claude Code plugin with `.claude-plugin/` and `hooks/`): the method, as sequential handoffs.
- **The AXI CLI** (`bin/brain.js`): thin; parses args, calls one library function, prints TOON with a `help:` list.
- **The library** (`lib/brain/`): the only code that touches `brain.db`. Per-domain functions over `node:sqlite`, schema migrations with a backup, WAL for concurrent writers.

The review and watch UIs (`lib/review/`) read the brain through the library; the CLI is the only writer. Contracts in [`docs/REVIEW-ARCHITECTURE.md`](docs/REVIEW-ARCHITECTURE.md).

## Upgrading from 0.2.x

0.3.0 replaces the markdown `.brain/` directory with `brain.db`, and file brains are not read. A repo with an old markdown brain gets `LEGACY_BRAIN`; pin the old CLI there with `npx -y brain-axi@0.2.0 <command>`, or move the old `.brain/` aside and run `brain init`. See [CHANGELOG.md](CHANGELOG.md).

## Design principles

- **Zero dependencies.** Node built-ins only, no build step.
- **TOON, not JSON or prose.** Token-efficient for agents to parse and for you to read.
- **Contextual disclosure.** Every result teaches the next command through `help:`.
- **Exit codes are the contract.** `0` / `1` / `2` are stable; scripts and CI can depend on them.
- **The [AXI standard](https://github.com/kunchenguid/axi)** for agent-facing CLIs (`npx skills add kunchenguid/axi`).
