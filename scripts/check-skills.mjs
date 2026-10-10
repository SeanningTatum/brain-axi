#!/usr/bin/env node
// scripts/check-skills.mjs — repo-dev check (was `brain skill --check`).
// Validates the skills/ tree and the Claude Code plugin packaging:
//   - every skills/<dir>/SKILL.md has frontmatter whose name matches the dir
//     and a description; size caps (router 6144 B, phase skills 10240 B)
//   - every phase skill has a `## Next` section naming skills that exist
//   - every `references/x.md` link resolves
//   - the router (skills/brain/SKILL.md) names every top-level CLI command,
//     read from `brain --help` so the list can never drift from COMMANDS
//   - plugin.json name/version (= package.json), marketplace lists the
//     plugin, hooks.json runs `bin/brain.js context` on SessionStart
// Exit 0 when valid, 1 with a TOON problems list otherwise.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SKILLS_DIR = path.join(ROOT, "skills");
const PLUGIN_NAME = "brain-axi";
const ROUTER_CAP = 6144; // bytes — the router is read on every session
const PHASE_CAP = 10240; // bytes — a phase skill; long material goes to references/

const read = (f) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");

// Top-level command names from `brain --help` (the commands[N]{name,summary} table).
function cliCommands() {
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin", "brain.js"), "--help"], { encoding: "utf8" });
  if (r.status !== 0) return { error: `bin/brain.js --help exited ${r.status}: ${(r.stdout + r.stderr).trim().split("\n")[0]}` };
  const lines = r.stdout.split("\n");
  const at = lines.findIndex((l) => /^commands\[\d+\]\{name,summary\}:$/.test(l));
  if (at === -1) return { error: "bin/brain.js --help printed no commands table" };
  const names = [];
  for (const l of lines.slice(at + 1)) {
    if (!l.startsWith("  ")) break;
    names.push(l.trim().split(",")[0].replace(/^"|"$/g, ""));
  }
  return { names };
}

function checkSkillsTree(problems) {
  if (!fs.existsSync(SKILLS_DIR)) return void problems.push("skills/ directory missing");
  const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const known = new Set(dirs);
  for (const dir of dirs) {
    const rel = `skills/${dir}/SKILL.md`;
    const file = path.join(SKILLS_DIR, dir, "SKILL.md");
    if (!fs.existsSync(file)) {
      problems.push(`${rel}: missing`);
      continue;
    }
    const raw = read(file);
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw);
    if (!fm) {
      problems.push(`${rel}: missing frontmatter`);
      continue;
    }
    const name = /^name: (.+)$/m.exec(fm[1]);
    const desc = /^description: (.+)$/m.exec(fm[1]);
    if (!name) problems.push(`${rel}: frontmatter has no name`);
    else if (name[1].trim() !== dir) problems.push(`${rel}: name "${name[1].trim()}" does not match directory "${dir}"`);
    if (!desc || !desc[1].trim()) problems.push(`${rel}: frontmatter has no description`);
    const cap = dir === "brain" ? ROUTER_CAP : PHASE_CAP;
    const size = Buffer.byteLength(raw);
    if (size > cap) problems.push(`${rel}: ${size} bytes exceeds the ${cap}-byte cap — move long material to references/`);
    if (dir !== "brain") {
      const next = /^## Next\n([\s\S]*)$/m.exec(raw);
      if (!next) problems.push(`${rel}: no \`## Next\` section`);
      else
        for (const m of next[1].matchAll(/`(brain-[a-z]+)`/g))
          if (!known.has(m[1])) problems.push(`${rel}: ## Next names skill "${m[1]}", which does not exist`);
    }
    const refDir = path.join(SKILLS_DIR, dir, "references");
    const have = fs.existsSync(refDir) ? fs.readdirSync(refDir) : [];
    for (const m of raw.matchAll(/`references\/([A-Za-z0-9._-]+)`/g))
      if (!have.includes(m[1])) problems.push(`${rel}: links references/${m[1]}, which does not exist`);
  }
  const routerFile = path.join(SKILLS_DIR, "brain", "SKILL.md");
  if (!fs.existsSync(routerFile)) return void problems.push("skills/brain/SKILL.md: router missing");
  const cli = cliCommands();
  if (cli.error) return void problems.push(cli.error);
  const router = read(routerFile);
  for (const c of cli.names) {
    const re = new RegExp("(?:`|brain(?:-axi)? )" + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Za-z0-9-])");
    if (!re.test(router)) problems.push(`skills/brain/SKILL.md: router never names command "${c}"`);
  }
}

function checkPluginFiles(problems) {
  const load = (rel) => {
    const f = path.join(ROOT, rel);
    if (!fs.existsSync(f)) return void problems.push(`${rel}: missing`);
    try {
      return JSON.parse(fs.readFileSync(f, "utf8"));
    } catch (e) {
      return void problems.push(`${rel}: invalid JSON (${e.message})`);
    }
  };
  const pkg = load("package.json");
  const plugin = load(".claude-plugin/plugin.json");
  if (plugin) {
    if (plugin.name !== PLUGIN_NAME) problems.push(`.claude-plugin/plugin.json: name is "${plugin.name}", expected "${PLUGIN_NAME}"`);
    if (pkg && plugin.version !== pkg.version)
      problems.push(`.claude-plugin/plugin.json: version "${plugin.version}" does not match package.json "${pkg.version}"`);
  }
  const market = load(".claude-plugin/marketplace.json");
  if (market && !(Array.isArray(market.plugins) && market.plugins.some((p) => p && p.name === PLUGIN_NAME)))
    problems.push(`.claude-plugin/marketplace.json: does not list plugin "${PLUGIN_NAME}"`);
  const hooks = load("hooks/hooks.json");
  if (hooks) {
    const entries = Array.isArray(hooks.hooks?.SessionStart) ? hooks.hooks.SessionStart : [];
    const ok = entries.some((m) => (m.hooks || []).some((h) => typeof h.command === "string" && /bin\/brain\.js"? context\b/.test(h.command)));
    if (!ok) problems.push("hooks/hooks.json: no SessionStart hook runs `bin/brain.js context`");
  }
}

const problems = [];
checkSkillsTree(problems);
checkPluginFiles(problems);
const q = (s) => (/[",:]|^\s|\s$/.test(s) ? JSON.stringify(s) : s);
if (!problems.length) {
  process.stdout.write("check-skills: skills/ tree and plugin files (.claude-plugin/, hooks/) are valid\n");
} else {
  process.stdout.write(
    [
      "error: skills/ tree or plugin files invalid",
      `problems[${problems.length}]:`,
      ...problems.map((p) => "  " + q(p)),
      "help[1]: Fix the problems listed above, then re-run `node scripts/check-skills.mjs`",
    ].join("\n") + "\n"
  );
  process.exitCode = 1;
}
