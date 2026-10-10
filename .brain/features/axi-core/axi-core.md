# Feature: axi-core — skills over a thin AXI over a SQLite library

_Last updated: 2026-10-10_

## Purpose
Three layers only: skills (method, sequential handoffs) → AXI CLI (thin, TOON) → lib/brain (SQLite, per-domain functions, migrations). Plan: `plans/2026-10-10-axi-architecture.html` (reviewed round 1). Supersedes sqlite-engine (feat-012, cut).

## Phases
1. Library + tests. 2. AXI on the library (15 commands). 3. Review + watch UIs on the library. 4. Skills on the new surface; evals repo-dev; HARNESS.md folded into skills. 5. Rebuild this repo brain from live parts.
