# Feature: skills-plugin — the method as skills, packaged as a Claude Code plugin

_Last updated: 2026-10-10_

## Purpose
The method (start, grill, plan, product, ux, ai, execute, verify, done, write) lives as skills that
trigger by description and hand off to each other, instead of CLI playbooks an agent must remember to
call. The CLI stays the only thing that reads or writes state. Plan: `plans/2026-10-09-skills-plugin-sqlite.html`.

## Phases
1. Skills become the source — `skills/brain-<id>/SKILL.md`, `brain playbook <id>` byte-identical.
2. Design them as skills — trigger descriptions, handoffs, references/, router skill, bootstrap line, size caps.
3. Plugin + install — `.claude-plugin/`, `hooks/`, `commands/`, plugin-aware `setup --app claude`.

## Non-goals
codex/opencode skill install; adopting obra/superpowers; any storage change (see sqlite-engine).
