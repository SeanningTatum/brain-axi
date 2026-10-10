// lib/review/playbooks.js — authoring standards for agent-produced review
// artifacts, printed verbatim by `brain playbook <id>` (bin/brain.js).
//
// The playbook texts live in skills/brain-<id>/SKILL.md at the repo root —
// the single source of truth. Each file is YAML frontmatter (name,
// description = the playbook's use_when, JSON-quoted) followed by the exact
// playbook body. This module loads them at import time (zero deps) and keeps
// the PLAYBOOKS export shape: { [id]: { id, use_when, content } }.
//
// See docs/REVIEW-ARCHITECTURE.md ("A4. Playbook command", "A5. The plan
// artifact standard") for the binding contract this module implements.

import { readFileSync } from "node:fs";

// Display order for `brain playbook` (the index table).
const IDS = ["start", "grill", "plan", "product", "ux", "ai", "verify", "execute", "done", "write"];

function load(id) {
  const file = new URL(`../../skills/brain-${id}/SKILL.md`, import.meta.url);
  const raw = readFileSync(file, "utf8");
  const m = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!m) throw new Error(`skills/brain-${id}/SKILL.md: missing frontmatter`);
  const d = /^description: (.*)$/m.exec(m[1]);
  if (!d) throw new Error(`skills/brain-${id}/SKILL.md: missing description`);
  const v = d[1].trim();
  const use_when = v.startsWith('"') ? JSON.parse(v) : v;
  return { id, use_when, content: raw.slice(m[0].length) };
}

export const PLAYBOOKS = Object.fromEntries(IDS.map((id) => [id, load(id)]));
