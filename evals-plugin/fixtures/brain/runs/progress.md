# Progress — rolling session log

> Single rolling log of "where am I right now". Append-only. Newest entry on top. Per-task deep state lives in `<YYYY-MM-DD>-<slug>.md` in this same directory — this file is just the cursor.

## How to use

- **Start of session**: read the top entry to recover state.
- **During session**: append one checkpoint per meaningful step (decision, blocker, branch switch, test failure, scope change) via `brain progress add --summary "..."`.
- **End of session**: `brain progress add --summary "..." --next "..."` so the next session picks up cleanly.

## Format per entry

```
## YYYY-MM-DD — <one-line summary>
- branch: <branch-name>
- in-progress feature: <slug> | none
- run note: <path or none>
- next: <one sentence>
```

---

## 2026-10-10 — brain initialized via `brain init`
- branch: `unknown`
- in-progress feature: none
- run note: none
