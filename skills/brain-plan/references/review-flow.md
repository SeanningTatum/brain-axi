[brain-plan reference — the review loop in full]

3. **`npx -y brain-axi review open <plan.html> --feature <slug>`** — registers the plan
   in the brain (the plan stays an ordinary repo file, e.g. `plans/<date>-<slug>.html`)
   and pops the review UI in the user's browser. The UI shows your plan beside brain
   memory panels (past plans, checkpoints, verifications), so the human reviews with
   full context. Add `--no-open` to skip launching the browser.
4. **Immediately run `npx -y brain-axi review poll <plan.html>` and wait for it in the
   foreground of this same turn.** It blocks until the human annotates and clicks Send —
   that is the point. Do not background-and-forget it, do not skip it, do not end your
   turn while it waits. If it gets interrupted or times out, re-run the same command:
   feedback is never lost.
5. When the poll returns prompts, apply each requested change to the SAME html file
   (the browser hot-reloads it), then
   `npx -y brain-axi review poll <plan.html> --agent-reply "what you changed"`
   and wait again. Each prompt carries `line` + `text` anchors (server-resolved
   against the artifact's current content) — apply edits with targeted reads
   (offset/limit) and anchored replacements; do NOT re-read the whole artifact
   just to find what a prompt refers to.
6. Repeat step 5 until the plan is approved or the session ends.

Rules:

- If a poll response shows `ended_by: user` (or `next_step` says the user ended it): **stop polling, do not reopen the browser**, apply any remaining feedback, and report the outcome in the conversation. Only reopen with `npx -y brain-axi review open <plan.html> --reopen` if the user explicitly asks to resume.
- If a poll response carries `layout_warnings`, fix any `severity: error` entry and wait for the next poll to confirm a clean audit; if the SAME warning comes back `persistent: true`, proceed and mention it to the human instead of looping.
- A poll's DOM snapshot is a compact outline, not the raw page — it prints as `snapshot_chars: N` by default; pass `--snapshot` to see the full outline block only when you actually need it.
- `npx -y brain-axi review end <plan.html>` — end the session yourself once the plan is fully approved. Headless/CI approval, with no browser session: `npx -y brain-axi review end <plan.html> --approved-by <who>` records an approval round and marks the plan approved.
- Screenshots are not attached to the plan. Evidence screenshots belong to a verification: `brain verifications add <slug> --verdict PASS --body-from <file> --shot <path>::<caption>` (see the `brain-verify` skill).
- `npx -y brain-axi plans list` / `plans view <slug>` — past plans and their review history. `plans view` prints `file`, `sha256`, `status`, `approved_by`, `rounds` (round, at, ended_by, prompts) and the prompts. The registered plan's approved round (file + `sha256`) is the FROZEN copy the human approved; `brain check` fails if the file's hash no longer matches, so after approval stop editing the file. When verifying a feature whose plan carried wireframes, compare the shipped UI against that approved plan, never against a copy the agent has since edited; record each difference in the verification verdict's mockup-reconciliation table (see the `brain-verify` skill).
- Prior art and history for a feature: `brain runs view <slug>`, `brain progress list --feature <slug>`, `brain verifications list --feature <slug>`, `brain plans list --feature <slug>`, and `brain search "<q>"`.
