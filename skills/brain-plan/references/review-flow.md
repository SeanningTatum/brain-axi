[brain-plan reference — the review loop in full (moved from the generated skill)]

3. **`npx -y brain-axi review <plan.html>`** — this pops the review UI in the user's
   browser. The UI shows your plan beside brain memory panels (past plans, timeline,
   screenshots), so the human reviews with full context.
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

- If a poll response shows `ended_by: user` (or `next_step` says the user ended it): **stop polling, do not reopen the browser**, apply any remaining feedback, and report the outcome in the conversation. Only reopen with `review <plan.html> --reopen` if the user explicitly asks to resume.
- If a poll response carries `layout_warnings`, fix any `severity: error` entry and wait for the next poll to confirm a clean audit; if the SAME warning comes back `persistent: true`, proceed and mention it to the human instead of looping.
- A poll's DOM snapshot is a compact outline, not the raw page — it prints as `snapshot_chars: N` by default; pass `--snapshot` to see the full outline block only when you actually need it.
- `npx -y brain-axi review end <plan.html>` — end the session yourself once the plan is fully approved
- `npx -y brain-axi shots add <img> --feature <slug> --step <NN-name>` — attach a screenshot to a feature (`--scope <plan-or-feature>` is the legacy form)
- `npx -y brain-axi plans` / `plans view <slug>` — see past plan artifacts and their review rounds. Each round prints a `snapshot:` path (`plans/<slug>/vN.html`) — the FROZEN copy of the artifact as it stood at that round. A snapshot is written for every round, so the newest one is NOT automatically the approved one: the approved snapshot — the FROZEN copy the human approved — is the one for the round that ended the review (`ended by` in the round header). `plans view` names it for you in its `help:` line, and says so explicitly when no round has ended yet. When verifying a feature whose plan carried wireframes, compare the shipped UI against that approved snapshot, never against the live artifact path (the agent has been editing it); record each difference in the verification doc's mockup-reconciliation table per `playbook verify` 5b.
- `npx -y brain-axi timeline` — merged history across checkpoints, run notes, plan reviews, and verifications
