# Progress — Rolling session log

> Single rolling log of "where am I right now". Append-only. Newest entry on top. **Per-task deep state lives in `<YYYY-MM-DD>-<task-slug>.md`** — this file is the index/state cursor.

## How to use

- **Start of session**: read the top entry to recover state.
- **During session**: append one bullet per meaningful checkpoint (decision, blocker, branch switch, test failure, scope change).
- **End of session**: add a `## Session end` block with: branch, last commit SHA, what's running/incomplete, what to do next.
- **Multi-day task**: link to the run note (`runs/<date>-<slug>.md`) for full detail. Keep entries here under ~5 lines each.

## Format per entry

```
## YYYY-MM-DD HH:MM (UTC) — <one-line summary>
- branch: <branch-name>
- in-progress feature: <feat-id> | none
- run note: <path or none>
- next: <one sentence>
```

---

## 2026-07-30 — PR #15: README Who-this-is-for + mermaid flow diagram — https://github.com/SeanningTatum/brain-axi/pull/15
- branch: `docs/who-its-for`
- in-progress feature: none
- run note: none
- next: merge #14 then #15 (both touch README, different regions — #15 may need a trivial rebase)

---

## 2026-07-29 — Phases 1-3 of ai-work shipped as PR #12 (feat/ai-work-harness). Pre-PR review: 4 subagent reviewers (Greptile API down), 0 P1 / 4 P2 / 8 P3 all fixed in bc6fa4f. Verification: 3x agreed CLI battery, gate 31/31 1.000.
- branch: `feat/ai-work-harness`
- in-progress feature: ai-work
- run note: none
- eval: skill-coverage 1.000 (+0.000), 31/31 pass, no frozen failures, cost 0, run 2026-07-29T05:02:23.081Z
- next: Phase 4: brain evals review <suite> — run artifact in the review server, annotations -> feedback/<date>.md

---

## 2026-07-29 — PR opened for ai-work: https://github.com/SeanningTatum/brain-axi/pull/12
- branch: `feat/ai-work-harness`
- in-progress feature: none
- run note: none

---

## 2026-07-29 — Phases 2+3 of ai-work: lib/review/evals.js data layer + brain evals (list/view/cases/runs/run/record/golden add|freeze) + promptfoo adapter + brain verify --stage evals gate (frozen hard-fail, tolerance band) + progress add --eval + home eval line + 4 new brain check rows + evals/index.md in brain init + dogfood suite skill-coverage (31 cases, 28 frozen) w/ reference runner. Suite caught 4 real skill gaps (evals/context/setup/skill undocumented) — fixed, 0.871 -> 1.000.
- branch: `feat/ai-work-harness`
- in-progress feature: ai-work
- run note: features/ai-work/runs/2026-07-29-progress.md
- eval: skill-coverage 1.000 (+0.000), 31/31 pass, no frozen failures, cost 0, run 2026-07-29T01:43:58.722Z
- next: Phase 4: brain evals review <suite> (generated run artifact + per-case annotation -> feedback/<date>.md); then phase 6 agent topology, phase 7 cf-saas-react-router-starter portability

---

## 2026-07-29 — Phase 1 of ai-work done on feat/ai-work-harness: new 'ai' playbook (347 lines: prompt contract, prompting practice, golden sets + synthesis, eval design/judge calibration, change loop, pipelines/guardrails, agent topology, human loop, anti-patterns, readiness) + AI branches in plan (§13 addendum), start (§3 evals read, §5 eval baseline), execute (3b per-prompt-change delta), done (§2b eval gate + DoD row) + skill 'AI work' section regenerated + .brain/rules/ai-work.md. brain check 9/9, verify 2/2, skill --check clean.
- branch: `feat/ai-work-harness`
- in-progress feature: ai-work
- run note: features/ai-work/runs/2026-07-29-progress.md
- next: Phase 2: .brain/evals data model + brain evals read verbs + check rows + init scaffold

---

## 2026-07-29 — Plan 'ai-work-harness' authored and reviewed 2 rounds: AI-aware harness (evals subsystem, playbook ai + AI branches, agent topology, promptfoo/langchain portability). Decisions 1-6 locked at recommended; rounds 1-2 answers applied (runs committed to git, --stage evals opt-in, calibration helper, topology state, trace_url + usage capture, roles descriptive-but-functional via optional impl pointer). Cards 7-9 (topology shape, adapter set, calibration depth) still unanswered.
- branch: `feat/orchestration-routing-bench`
- in-progress feature: none
- run note: none
- next: Get answers on cards 7-9 (or accept recommended), create feat-006 ai-work, then start Phase 1: brain playbook ai + AI branches in plan/start/execute/done + skill sync

---

## 2026-07-23 — harness-mode shipped + PR #8 opened: https://github.com/SeanningTatum/brain-axi/pull/8 — brain verify (registry runner), start/done playbooks, brain init scaffolder. 4 commits on feat/harness-mode. Deferred: setup --commands (D0). Uncommitted README/asset work from a prior session left untouched.
- branch: `feat/harness-mode`
- in-progress feature: none
- run note: none
- next: Await PR review/merge; adopt in cf-saas-starter (replace init.sh/harness-check.sh with verify.json); revisit setup --commands after real-repo usage

---

## 2026-07-23 — PR opened for harness-mode: https://github.com/SeanningTatum/brain-axi/pull/8
- branch: `feat/harness-mode`
- in-progress feature: none
- run note: none

---

## 2026-07-23 — shipped harness-mode: verify 2/2 pass recorded as run-note step 5 (features/harness-mode/runs/2026-07-23-progress.md); brain check 10 rows all
- branch: `feat/harness-mode`
- in-progress feature: none
- run note: none

---

## 2026-07-23 — Plan harness-parity reviewed round 2: all decisions locked (verify.json registry, one verify verb --stage, opt-in --feature recording, bootstrap stage in, setup --commands deferred, brain init promoted to Phase 3). feat-005 harness-mode opened in-progress on feat/harness-mode. Starting Phase 1: cmdVerify.
- branch: `feat/harness-mode`
- in-progress feature: none
- run note: none

---

## 2026-07-23 — Kickoff: harness-parity plan — map cf-saas-starter AGENTS.md harness onto brain-axi CLI, gap = verify runner + bookend playbooks + generated slash commands. Authoring plan artifact for review.
- branch: `main`
- in-progress feature: none
- run note: none

---

## 2026-07-17 — shot-review PR opened: https://github.com/SeanningTatum/brain-axi/pull/4 — carousel + annotation + CTA toast + shots notes verb, all verified. Pre-PR review inline (Greptile down, org spend limit blocked workflow review); 1 finding fixed (3f71dca).
- branch: `feat/shot-review-carousel`
- in-progress feature: none
- run note: none
- next: Await PR review/merge; optional follow-ups: lightbox zoom/pan, chrome annotations persisting to annotations.json

---

## 2026-07-17 — PR opened for shot-review: https://github.com/SeanningTatum/brain-axi/pull/4
- branch: `feat/shot-review-carousel`
- in-progress feature: none
- run note: none

---

## 2026-07-17 — shipped shot-review: Verification PASS 2026-07-17 (features/shot-review/verifications/2026-07-17.md): Playwright walk of /watch/shot-review —
- branch: `feat/shot-review-carousel`
- in-progress feature: none
- run note: none

---

## 2026-07-17 — Plan 2026-07-16-shot-carousel-annotation approved round 1 (D1-D4 all recommended): shared lightbox.js carousel on both surfaces, pin+note annotation, persist-to-brain for /watch, filmstrip. Lifecycle: shot re-capture supersedes old annotations. Starting execution as coordinator.
- branch: `feat/shot-review-carousel`
- in-progress feature: none
- run note: none
- next: Phase 1+2: lightbox component + wire both surfaces

---

## 2026-07-16 — PR opened for brain-review: https://github.com/SeanningTatum/brain-axi/pull/2
- branch: `feat/execution-dashboard`
- in-progress feature: none
- run note: none

---

## 2026-07-16 — shipped brain-review: Execution dashboard verified PASS 2026-07-16: /watch/brain-review rendered all sections (pipeline, health 8/8, step acco
- branch: `feat/execution-dashboard`
- in-progress feature: none
- run note: none

---

## 2026-07-16 — Plan 2026-07-16-execution-dashboard approved (round 1, D1-D4 all recommended): /watch/<feature> dashboard on review server, brain pr verb, step accordion, end-of-session handoff link. Starting execution.
- branch: `main`
- in-progress feature: none
- run note: none
- next: Phase 1: brain-data run-step parser + pr.json + watchContext

---

## 2026-07-14 — Harness loop closed: .brain-onto-itself + .claude/commands verified. skill --check + brain check 8/8 green. Run note 2026-07-14-harness-self-setup shipped.
- branch: `feat/execution-mode-v2`
- in-progress feature: none
- run note: none
- next: idle — optional: commit run artifacts + .claude/commands; add slash-commands section to CLAUDE.md

---

## 2026-07-14 — Walking harness loop to formalize .brain-onto-itself + .claude/commands setup. Run note 2026-07-14-harness-self-setup opened.
- branch: `feat/execution-mode-v2`
- in-progress feature: none
- run note: none
- next: verify-done: brain coherence + check + skill, then checkpoint

---

## 2026-07-14 — Turned .brain onto brain-axi itself: real HARNESS, codebase/programming-model, 4 layer rules, architecture, feat-001 core-cli (shipped) + feat-002 brain-review (in-progress). check 8/8, skill --check green.
- branch: `main`
- in-progress feature: none
- run note: none

---

_No entries yet — append the first checkpoint above this line._
