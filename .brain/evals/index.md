# Evals

One directory per eval suite — the golden set and run history for anything whose output comes from a model. brain-axi calls no models itself; the suite here scores the thing that IS brain-axi's prompt: the generated agent skill.

```
evals/<suite>/
  suite.json      kind, runner, adapter, thresholds, prompt pointers
  cases.jsonl     the golden set — one JSON object per line
  runs.jsonl      run history summaries (committed)
  runs/<ts>.json  full per-case results for one run
  feedback/<date>.md   human review notes on prompts + outputs
```

## Suites

| Suite | Kind | What it measures |
|-------|------|------------------|
| [`skill-coverage`](skill-coverage/) | assertions | `skills/` tree (router + phase skills) names every command, states the TOON contract and the AI rules, and invents no tooling this repo lacks |
| [`skill-routing`](skill-routing/) | judge | Does the right `brain-*` skill fire first for a prompt (typical/edge/adversarial/no-.brain bands)? Driven by `claude plugin eval` (cases in `evals-plugin/`), with-plugin vs no-plugin baseline; 8 held-out cases in `heldout.jsonl`, reported in `split-runs.jsonl`, outside the gate. LIVE: ~$7 per run |

## Rules that bind here

- A case is `{id, input, expected, tags[], frozen, origin, note}`. `frozen: true` means it may never regress at any aggregate score — that is the gate, not a preference.
- Every bug fixed in agent-facing text becomes a frozen case in the same session.
- Runs are committed in full, including per-case output (capped by `max_output_chars`).
- Read [`../rules/ai-work.md`](../rules/ai-work.md) before changing this subsystem, and `brain playbook ai` for the standard behind it.

Run `brain evals` for the live list, `brain evals view <suite>` for one suite.
