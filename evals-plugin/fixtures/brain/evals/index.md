# Evals

One directory per eval suite — the golden set and run history for anything whose output comes from a model.

```
evals/<suite>/
  suite.json      kind, runner, adapter, thresholds, prompt pointers
  cases.jsonl     the golden set — one JSON object per line
  runs.jsonl      run history summaries (committed)
  runs/<ts>.json  full per-case results for one run
  feedback/<date>.md   human review notes on prompts + outputs
```

suite.json shape: `{"version":1,"kind":"assertions","runner":"node scripts/eval-<suite>.mjs","thresholds":{"min_pass_rate":0.9}}`

A case is `{id, input, expected, tags[], frozen, origin, note}`. `frozen: true` means the case may never regress at any aggregate score — that is the gate.

Run `brain evals` for the live list and `brain playbook ai` for the standard: how to build the golden set, which eval kind to use, and the change loop (baseline → one change → re-run → compare per-case).
