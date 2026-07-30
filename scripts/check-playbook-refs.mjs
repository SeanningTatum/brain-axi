#!/usr/bin/env node
// Playbook internal-consistency check — zero deps, zero network, no browser.
//
// Playbooks cross-reference each other by section number ("section 8", "`plan`
// §10") and the ux playbook's HTML examples use CSS classes its own kit is
// supposed to define. Both are hand-maintained prose, so both rot silently:
// renumbering a section leaves live references pointing at nothing, and an
// example can use a `.wf-*` class the kit never shipped. Neither shows up in
// `brain check` (that validates .brain data, not guidance text) nor in the
// skill-coverage eval (that scores the generated skill, not the playbooks).
//
// Run: node scripts/check-playbook-refs.mjs   (exit 1 on any dangling ref)
import { PLAYBOOKS } from "../lib/review/playbooks.js";

const failures = [];
const ids = Object.keys(PLAYBOOKS);

// ---------------------------------------------------------------------------
// Section inventory — top-level "N. HEADING", lettered "Nb. HEADING", and
// "--- N.M SUBSECTION ---" forms, all at line start.
// ---------------------------------------------------------------------------
function sectionsOf(content) {
  const nums = new Set();
  for (const line of content.split("\n")) {
    let m = /^(\d+)[a-z]?\. [A-Z(]/.exec(line);
    if (m) nums.add(m[1]);
    m = /^--- (\d+)(?:\.\d+)? /.exec(line);
    if (m) nums.add(m[1]);
  }
  return nums;
}

const sections = Object.fromEntries(ids.map((id) => [id, sectionsOf(PLAYBOOKS[id].content)]));

// ---------------------------------------------------------------------------
// Cross-references. A reference is attributed to another playbook when the
// text names one right before it (`plan` §10, `brain playbook plan` section 8);
// otherwise it is a self-reference to the containing playbook.
// ---------------------------------------------------------------------------
const REF_RE = new RegExp(
  String.raw`(?:\`(?:brain playbook |npx -y brain-axi playbook )?(${ids.join("|")})\`[^.\n]{0,40}?)?` +
    String.raw`(?:§|[Ss]ection )(\d+)`,
  "g"
);

for (const id of ids) {
  const content = PLAYBOOKS[id].content;
  for (const m of content.matchAll(REF_RE)) {
    const target = m[1] || id;
    const num = m[2];
    if (!sections[target]) {
      failures.push(`${id}: reference to unknown playbook "${target}"`);
      continue;
    }
    if (!sections[target].has(num)) {
      const where = content.slice(0, m.index).split("\n").length;
      failures.push(
        `${id}:${where}: references ${target === id ? "" : `${target} `}section ${num}, ` +
          `which does not exist (${target} has: ${[...sections[target]].join(", ")})`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Wireframe kit — every `.wf-*` class used in an HTML example must be defined
// in the kit's own CSS block.
// ---------------------------------------------------------------------------
const uxContent = PLAYBOOKS.ux ? PLAYBOOKS.ux.content : "";
if (uxContent) {
  const defined = new Set();
  // Selector position: `.wf-block.tall {` / `.wf { ... }` — take every class in
  // a rule head, which is any line containing "{" before a "}".
  for (const line of uxContent.split("\n")) {
    const head = line.split("{")[0];
    if (!line.includes("{")) continue;
    for (const m of head.matchAll(/\.((?:wf|wf-)[a-z-]*|tall|short|med|primary)\b/g)) defined.add(m[1]);
  }
  const used = new Set();
  for (const attr of uxContent.matchAll(/class="([^"]+)"/g)) {
    for (const cls of attr[1].split(/\s+/)) if (/^(wf|tall|short|med|primary)/.test(cls)) used.add(cls);
  }
  for (const cls of used) {
    if (!defined.has(cls)) failures.push(`ux: example uses .${cls}, which the wireframe kit never defines`);
  }
  if (defined.size === 0) failures.push("ux: wireframe kit defines no classes — did the CSS block move?");
}

// ---------------------------------------------------------------------------
// Playbook ids named in guidance must resolve. Only the backticked command
// form counts — bare prose ("this playbook is…") is not a reference.
// ---------------------------------------------------------------------------
for (const id of ids) {
  for (const m of PLAYBOOKS[id].content.matchAll(/`(?:npx -y brain-axi |brain )?playbook ([a-z][a-z-]*)`/g)) {
    const named = m[1];
    if (!ids.includes(named)) {
      const where = PLAYBOOKS[id].content.slice(0, m.index).split("\n").length;
      failures.push(`${id}:${where}: names playbook "${named}", which does not exist (have: ${ids.join(", ")})`);
    }
  }
}

if (failures.length) {
  console.error(`playbook-refs: ${failures.length} problem(s)`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`playbook-refs: ok — ${ids.length} playbooks, all section refs, kit classes, and ids resolve`);
