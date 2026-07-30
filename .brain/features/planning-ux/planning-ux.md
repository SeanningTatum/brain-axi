# Feature: planning-ux — product-grade planning (mockups, UX flows, product playbook)

_Last updated: 2026-07-30_

## Purpose

Plans produced by this harness are engineering-shaped: architecture, phases, files, tests. Two things are missing before a human can approve one honestly — **what the thing looks like** (screens, their states, the flow between them) and **why this is the right product bet** (who it's for, what success is, what is deliberately not being built). This feature adds both to the planning surface.

## When It's Used

- `brain playbook product` — before writing any plan for user-facing work: problem + evidence, user + job-to-be-done, success metric with a number, non-goals, scope tiers (thin / complete / gold), prior art, and a recommendation-with-rationale on every product decision.
- `brain playbook ux` — whenever a plan changes or adds a screen: wireframe CSS kit, screen inventory, screen-state matrix (empty / loading / error / success), user-journey flow diagram, variant A/B decision cards.
- `brain playbook plan` — conditional branches pointing at both, in the same idiom §13 (AI addendum) already uses.
- `brain playbook start` / `done` — product framing at kickoff, "product claims still true" at close.

## Decisions (plan `product-planning-mockups`, 2026-07-30, approved round 1)

All six decision cards were answered at the recommended option:

1. **Packaging** — two new playbooks (`product`, `ux`) with thin conditional branches in `plan`, mirroring how `ai` shipped. Keeps the plan playbook skimmable and loads the bulk only when relevant.
2. **Fidelity** — greyscale HTML wireframe kit as the default; reference images + pin-drop annotation stay available as the escape hatch for dense visuals.
3. **Gate** — conditional: `product` required for any user-facing change, `ux` required only when a screen changes.
4. **Product depth** — full brief: problem + evidence, user/JTBD, numeric success metric, non-goals, scope tiers, prior art, recommendation + rationale.
5. **Decision split** — product decisions get their own section, ordered before technical decisions.
6. **Sign-off** — yes, as separable Phase 4: an approved mockup is persisted and `verify` compares the shipped screenshot against it.

## Phases

1. `product` playbook + product sections/branch in `plan`.
2. `ux` playbook + wireframe kit folded into `plan` §0's style block.
3. Bookend wiring (`start`, `done`), `skillContent()` regeneration, `.brain/rules/planning-ux.md`, new `skill-coverage` eval cases.
4. (Gated) approved mockup persisted as verification evidence; `verify` playbook comparison step.

## Constraints

- `lib/review/playbooks.js` is the single source for playbook text; `bin/brain.js` `skillContent()` must be regenerated in the same change or `brain skill --check` exits 1.
- Wireframe controls carry `data-brain-action`, same rule decision cards follow, or annotate mode swallows the click.
- Everything renders offline: pure CSS wireframes, mermaid degrades to `<pre>` text.
- `policy.one_in_progress_at_a_time` — this feature stays `planned` until `ai-work` ships; work happens on `feat/planning-ux` and the status flips at ship time.
