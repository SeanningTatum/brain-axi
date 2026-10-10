// check-skills' command-reference scanner: shell continuation lines and
// subcommand-less forms are checked against the right command's flags.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cliCommands, cliSurface, checkCommandRefs } from "../scripts/check-skills.mjs";

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
