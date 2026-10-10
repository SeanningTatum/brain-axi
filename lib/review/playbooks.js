// lib/review/playbooks.js — authoring standards for agent-produced review
// artifacts, printed verbatim by `brain playbook <id>` (bin/brain.js).
//
// The playbook texts live in skills/brain-<id>/SKILL.md at the repo root —
// the single source of truth. Each file is YAML frontmatter (name,
// description = the playbook's use_when, JSON-quoted) followed by the exact
// playbook body. This module loads them at import time (zero deps) and keeps
// the PLAYBOOKS export shape: { [id]: { id, use_when, content } }.
//
// Long material lives in skills/brain-<id>/references/<topic>.<ext>. Each
// playbook exposes `refs` ([{ name, file }], sorted) and `full` (SKILL.md body
// plus every reference, for consistency checks); readRef(id, topic) returns
// one reference's text. `content` stays the SKILL.md body only.
//
// See docs/REVIEW-ARCHITECTURE.md ("A4. Playbook command", "A5. The plan
// artifact standard") for the binding contract this module implements.

import { readFileSync, readdirSync, existsSync } from "node:fs";

// Skills may be checked out with CRLF (core.autocrlf on Windows); parse as LF.
const read = (file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

// Display order for `brain playbook` (the index table).
const IDS = ["start", "grill", "plan", "product", "ux", "ai", "verify", "execute", "done", "write"];

function load(id) {
  const file = new URL(`../../skills/brain-${id}/SKILL.md`, import.meta.url);
  const raw = read(file);
  const m = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!m) throw new Error(`skills/brain-${id}/SKILL.md: missing frontmatter`);
  const d = /^description: (.*)$/m.exec(m[1]);
  if (!d) throw new Error(`skills/brain-${id}/SKILL.md: missing description`);
  const v = d[1].trim();
  const use_when = v.startsWith('"') ? JSON.parse(v) : v;
  const content = raw.slice(m[0].length);
  const dir = new URL(`../../skills/brain-${id}/references/`, import.meta.url);
  const refs = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => !f.startsWith("."))
        .sort()
        .map((file) => ({ name: file.replace(/\.[^.]+$/, ""), file }))
    : [];
  const full = [content, ...refs.map((r) => read(new URL(r.file, dir)))].join("\n");
  return { id, use_when, content, refs, full };
}

// Text of one reference file, or null when the topic does not exist.
export function readRef(id, topic) {
  const r = PLAYBOOKS[id]?.refs.find((x) => x.name === topic);
  if (!r) return null;
  return read(new URL(`../../skills/brain-${id}/references/${r.file}`, import.meta.url));
}

export const PLAYBOOKS = Object.fromEntries(IDS.map((id) => [id, load(id)]));
