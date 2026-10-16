[brain-ai reference — section 8: the human loop]

-------------------------------------------------------------------------------
8. THE HUMAN LOOP — prompts and evals are reviewable artifacts
-------------------------------------------------------------------------------

Numbers do not tell you the output is any good; they tell you it changed. Put
the actual prompt and the actual outputs in front of the human:

- Surface the **prompt text** and a **sample of per-case outputs** (failures
  first) for review — the human reads what the model actually wrote, not a
  score summary of it.
- Their comments land somewhere durable (the PR, a feedback note beside the
  suite), and they feed BOTH the prompt (fix the instruction) and the golden set (encode
  the judgment as a case). Feedback that only edits the prompt is feedback you
  will need again.
- **Unreviewed feedback blocks "done."** If a human commented on eval output
  and nothing in the prompt or the golden set changed in response, the task is
  not finished — see the `brain-done` skill.
- Re-review after material prompt changes. A prompt the human blessed three
  rewrites ago has not been reviewed.

