# Rule: Planning surface (`playbook product`, `playbook ux`, the plan artifact's conditional sections)

_Layer: `lib/review/playbooks.js` (agent-facing standards) + `skillContent()` in `bin/brain.js`._

Read when: editing the `product` or `ux` playbook, adding/renumbering a section in the `plan` playbook, or changing what a plan artifact must contain before a human can approve it.

## Code layout

| Surface | Where | Owns |
|---------|-------|------|
| `brain playbook product` | `PLAYBOOKS.product` | The product case: problem + evidence, user + JTBD, success metric (fallback ladder), non-goals, scope tiers, prior art, product decision cards, anti-patterns, readiness |
| `brain playbook ux` | `PLAYBOOKS.ux` | Wireframe CSS kit, screen inventory, screen-state matrix, user-journey flow, layout variant cards, annotation truth, anti-patterns, readiness |
| Plan §3, §7 | `PLAYBOOKS.plan` | Thin conditional branches into `playbook product` — product brief, product decisions |
| Plan §6 | `PLAYBOOKS.plan` | Thin conditional branch into `playbook ux` — UI mockups + UX flows |
| Start §2b | `PLAYBOOKS.start` | Two-sentence product framing at kickoff (who + how you'll know it worked) |
| Done §2c + DoD | `PLAYBOOKS.done` | Metric observed, non-goals held, shipped UI reconciled against approved mockups |
| Skill playbook index | `skillContent()` in `bin/brain.js` | Eight playbook rows + the conditional-section map in the plan-review flow |

## The plan artifact's section numbering (0-16)

Renumbered on 2026-07-30 when the three conditional sections landed. The mapping from the old 0-13 layout, for anyone reading an older plan or an older reference:

| New | Section | Was |
|-----|---------|-----|
| 0-2 | Shared foundations, header, TL;DR | unchanged |
| **3** | **Product brief** (conditional) | new |
| 4 | Context | 3 |
| 5 | Big picture | 4 |
| **6** | **UI mockups + UX flows** (conditional) | new |
| **7** | **Product decisions** (conditional) | new |
| 8 | Technical decisions needed | 5 |
| 9 (9.1-9.4) | Interactive review components | 6 (6.1-6.4) |
| 10 | Plan of record | 7 |
| 11 | Files that change | 8 |
| 12 | Golden path | 9 |
| 13 | Error paths | 10 |
| 14 | Testing plan | 11 |
| 15 | Open questions | 12 |
| 16 | AI addendum | 13 |

Section numbers are cross-referenced from inside the playbook text, from the `ai` playbook, from `skillContent()`, and from `.brain/rules/ai-work.md`. **Renumbering again means grepping all four.**

## Do

- **Keep the plan playbook's new sections THIN.** Sections 3, 6, and 7 are pointers with just enough substance to make the reader want the real thing. The standards live in `product` / `ux`, loaded only when the plan needs them — that was decision 1 of the `product-planning-mockups` plan, and it exists so a refactor plan does not pay for a wireframe standard it will never use.
- **Every conditional section states its own skip condition first.** Same idiom as the `ai` playbook's §0 and plan §16. A conditional that nags on work it does not apply to teaches agents to skim playbooks.
- **Wireframes stay greyscale by default** — the `.wf-*` kit reuses the plan palette's custom properties (`--surface`, `--border`, `--fg`, `--muted`, `--space-*`) so it cannot drift from the document. Greyscale gets critiqued for layout; styled mockups get critiqued for color, and a planning round spent on color is a planning round lost.
- **Every interactive wireframe control carries `data-brain-action`** — the same rule decision cards follow. Without it, annotate mode's click interception (`shouldSkip` in `lib/review/sdk.js`) swallows the click as an element annotation.
- **Product decision cards reuse `queueDecision` verbatim** — same `decision-card` class, same queueKey discipline, same `data-brain-action` rule. A second queuing path is a second thing to keep in sync.
- **Every product decision card carries a recommendation with a rationale.** A card that lists options and takes no position is the planner outsourcing its job to the reviewer.
- **Re-run `node bin/brain.js skill --check`** after any playbook edit, and `skill --write` when it reports stale.

## Don't

- Don't inline the product or UX standard into the plan playbook — the whole point of two extra ids is that the bulk loads on demand.
- Don't let a mockup contradict section 10's plan of record. A wireframe showing a control no phase builds is a wireframe that will be approved and then quietly not shipped.
- Don't fill a screen-state matrix with `n/a` to make it look complete. A blank cell is a visible design hole; `n/a` everywhere is the same hole with a lid on it.
- Don't promote hi-fi styled mockups into the default path without a new decision — decision 2 chose greyscale-by-default with reference images + pin-drop as the escape hatch for dense visuals.
- Don't invent metrics, slugs, or checkpoint dates in worked examples without saying they are invented. The `product` playbook says so once, near the top, on purpose.

## Update triggers

- New or renumbered plan section → this doc's numbering table + every cross-reference in `PLAYBOOKS.plan`, `PLAYBOOKS.ai`, `skillContent()`, `.brain/rules/ai-work.md`, then `skill --write`
- New `.wf-*` class or kit change → `PLAYBOOKS.ux` section 1 + plan §0's style block guidance
- Annotation behaviour changes in `lib/review/sdk.js` → `PLAYBOOKS.ux` section 6 (it documents the real `shouldSkip` / pin-drop rules; stale text there is worse than none) + `.brain/rules/review-browser.md`
- Mockup sign-off persistence lands (phase 4) → `PLAYBOOKS.ux` + `PLAYBOOKS.verify` + `PLAYBOOKS.done` §2c + new `brain check` rows
- Any new playbook id → `skillContent()`'s playbook list + a `skill-coverage` eval case

## Provenance

Plan `product-planning-mockups` (2026-07-30, approved round 1). All six decision cards were answered at the recommended option: two new playbooks with thin branches in `plan`; greyscale HTML wireframe kit with images + pin-drop as the escape hatch; conditional gating (product on user-facing change, ux on screen change); the full product brief including scope tiers; product decisions split ahead of technical ones; and mockup sign-off as verification evidence in a separable phase 4.
