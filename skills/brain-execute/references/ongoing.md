[brain-execute reference — ongoing]

-------------------------------------------------------------------------------
ONGOING
-------------------------------------------------------------------------------

- **`brain check`** — run it any time you want a deterministic read on
  harness health (feature_list.json validity, the one-in-progress policy,
  every feature doc resolving, dependency refs, plan/review file integrity,
  verification docs having a Verdict line, `tasks.json` schema validity, no
  `shipped` feature with an open task). Exit 1 on any failing check — usable
  as a CI gate, and worth running before you claim anything is done.
- If a review session is open for this feature's plan, the chrome sidebar's
  Execution section mirrors this same state (feature status + evidence,
  `brain check` health, latest checkpoints, verifications, screenshots)
  live as you work — you do not need to narrate progress in chat separately
  from what these commands already persist.
- If you are also polling that review session (`brain review poll`), each
  returned prompt carries `line` + `text` anchors resolved against the plan
  artifact's current content — apply edits via targeted reads/anchored
  replacements at that line, not a full re-read of the artifact.
- Every command above supports `--help`; every result carries a `help:`
  line pointing at the next command in this loop.

