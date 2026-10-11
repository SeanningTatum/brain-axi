// check-skills' command-reference scanner: shell continuation lines and
// subcommand-less forms are checked against the right command's flags.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cliCommands, cliSurface, checkCommandRefs, checkGuidanceRefs } from "../scripts/check-skills.mjs";

function scan(t, md) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-skills-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "SKILL.md");
  fs.writeFileSync(file, md);
  const { surface, error } = cliSurface(cliCommands().names);
  assert.equal(error, undefined);
  const problems = [];
  checkCommandRefs(problems, [file], surface);
  return problems;
}

test("a flag on a shell continuation line is checked against its command", (t) => {
  const ok = "```\nbrain verifications add auth --verdict PASS \\\n  --body \"walked\" \\\n  --verified-by v1\n```\n";
  assert.deepEqual(scan(t, ok), []);
  const typo = "```\nbrain verifications add auth --verdict PASS \\\n  --verifed-by v1\n```\n";
  const p = scan(t, typo);
  assert.equal(p.length, 1, p.join("\n"));
  assert.match(p[0], /has no flag --verifed-by/);
  const indented = "    brain verifications add auth --verdict PASS \\\n        --shotz x.png\n";
  assert.match(scan(t, indented).join("\n"), /has no flag --shotz/);
});

test("a command without a subcommand is checked against its DEFAULT subcommand's flags", (t) => {
  assert.match(scan(t, '`brain verify --run "node --test"`\n').join("\n"), /`brain verify` has no flag --run/);
  assert.deepEqual(scan(t, "`brain verify --stage verify`\n"), []);
});

test("a literal feature name after a command with a default subcommand is that default's positional", (t) => {
  assert.deepEqual(scan(t, "`brain tasks auth`\n"), []);
  assert.deepEqual(scan(t, "`brain runs auth --run 2026-10-10-progress`\n"), []);
  assert.match(scan(t, "`brain runs auth --verdict PASS`\n").join("\n"), /has no flag --verdict/);
});

test("an a|b subcommand form is checked per subcommand: a flag must work on every alternative", (t) => {
  const p = scan(t, "`brain tasks list|claim auth --by worker`\n");
  assert.equal(p.length, 1, p.join("\n"));
  assert.match(p[0], /`brain tasks list\|claim` has no flag --by/);
  assert.deepEqual(scan(t, "`brain tasks claim auth --key t1 --by worker`\n"), []);
  assert.deepEqual(scan(t, "`brain features list|view --brain x`\n"), [], "global flags work on every subcommand");
});

test("a bare command-map summary (no `brain` prefix) lists its subcommands' flags together", (t) => {
  assert.deepEqual(scan(t, "- `verify list|add|run [--stage verify] [--only <name>]` — checks\n"), []);
  assert.match(scan(t, "- `verify list|add|run [--stagez verify]` — checks\n").join("\n"), /has no flag --stagez/);
});

// A skills/ tree in a temp dir: { "brain-x": { "SKILL.md": "...", "references/y.md": "..." } }.
function guidance(t, tree) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-guidance-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [skill, files] of Object.entries(tree))
    for (const [rel, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, skill, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, skill, rel), body);
    }
  const problems = [];
  checkGuidanceRefs(problems, dir);
  return problems;
}

test("section references must resolve: own sections, `plan` §N, and section N of the `brain-plan` skill", (t) => {
  const plan = { "SKILL.md": "1. HEADER STRIP (title). 2. TL;DR (three sentences).\n8. TECHNICAL DECISIONS\n", "references/r.md": "--- 10.1 PLAN OF RECORD ---\n" };
  const ok = guidance(t, {
    "brain-plan": plan,
    "brain-grill": { "SKILL.md": "1. KIT\nSee section 1, `plan` §10, §2 of `plan`, and section 8 of the `brain-plan` skill.\n" },
  });
  assert.deepEqual(ok, []);
  const bad = guidance(t, {
    "brain-plan": plan,
    "brain-grill": { "SKILL.md": "1. KIT\nSee section 4, then `plan` §12 and section 9 of the `brain-plan` skill.\n" },
  });
  assert.equal(bad.length, 3, bad.join("\n"));
  assert.match(bad.join("\n"), /brain-grill: references section 4, which does not exist/);
  assert.match(bad.join("\n"), /references brain-plan section 12/);
  assert.match(bad.join("\n"), /references brain-plan section 9/);
});

test("every wireframe class an example uses must be defined by the brain-ux kit", (t) => {
  const kit = "```css\n.wf { border: 1px solid; }\n.wf-btn.primary { color: #000; }\n```\n";
  assert.deepEqual(guidance(t, { "brain-ux": { "SKILL.md": "1. KIT\n", "references/kit.md": kit + '<div class="wf"><b class="wf-btn primary">x</b></div>\n' } }), []);
  const p = guidance(t, { "brain-ux": { "SKILL.md": "1. KIT\n", "references/kit.md": kit }, "brain-plan": { "SKILL.md": '<div class="wf wf-card">x</div>\n' } });
  assert.equal(p.length, 1, p.join("\n"));
  assert.match(p[0], /brain-plan: an example uses \.wf-card, which the brain-ux wireframe kit never defines/);
});
