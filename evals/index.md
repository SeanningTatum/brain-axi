# Evals

Repo-dev tooling for brain-axi itself, not part of the product: the `brain` CLI knows nothing about evals. One directory per suite, holding the golden set and the run history for the thing that IS brain-axi's prompt, the agent skills tree (`skills/`).

```
evals/<suite>/
  suite.json      kind, runner, adapter, thresholds, prompt pointers
  cases.jsonl     the golden set, one JSON object per line
  runs.jsonl      run history summaries (committed)
  runs/<ts>.json  full per-case results for one run
```

## Suites

| Suite | Kind | What it measures | Run |
|-------|------|------------------|-----|
| [`skill-coverage`](skill-coverage/) | assertions | `skills/` (router + phase skills + references) names every command, states the TOON contract and the AI rules, names no cut command or markdown-era path, and invents no tooling this repo lacks | `node scripts/eval-skill-coverage.mjs [--record]` |
| [`skill-routing`](skill-routing/) | judge | Does the right `brain-*` skill fire first for a prompt (typical/edge/adversarial/no-brain bands)? Driven by `claude plugin eval` (cases in `evals-plugin/`, each scaffolded by a fresh `brain init`), with-plugin vs no-plugin baseline; 8 held-out cases in `heldout.jsonl`, reported in `split-runs.jsonl`, outside the gate | `node scripts/eval-skill-routing.mjs gen` (free), `live` (LIVE: ~$7 per run) |

`--record` (and `live`) append `runs/<ts>.json` + a `runs.jsonl` row via `scripts/eval-record.mjs` and exit 1 when a frozen case fails or the score is under `min_pass_rate`.

## Rules that bind here

- A case is `{id, input, expected, tags[], frozen, origin, note}`. `frozen: true` means it may never regress at any aggregate score. That is the gate, not a preference.
- Every bug fixed in agent-facing text becomes a frozen regression case in the same session.
- Runs are committed in full, including per-case output (capped by `max_output_chars`). Run records are history: never deleted or rewritten.
- `node scripts/check-skills.mjs` is the structural gate (frontmatter, caps, links, every named command and flag real); these suites measure content and routing on top of it.
