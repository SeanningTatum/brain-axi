# Feature: sqlite-engine — node:sqlite storage for new brains

_Last updated: 2026-10-10_

## Purpose
New brains store everything in a gitignored `.brain/brain.db` (node:sqlite, node >=24, FTS5). Plan:
`plans/2026-10-09-skills-plugin-sqlite.html`, phases 4-5. Blocked on an answer to backup/CI
(`brain export`/`import`) before starting.
