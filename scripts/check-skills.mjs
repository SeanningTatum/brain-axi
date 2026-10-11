#!/usr/bin/env node
// scripts/check-skills.mjs — repo-dev check, run in CI.
// Validates the skills/ tree and the Claude Code plugin packaging:
//   - every skills/<dir>/SKILL.md has frontmatter whose name matches the dir
//     and a description; size caps (router 6144 B, phase skills 10240 B)
//   - every phase skill has a `## Next` section naming skills that exist
//   - every `references/x.md` link resolves (in SKILL.md and in references)
//   - the router (skills/brain/SKILL.md) names every top-level CLI command,
//     read from `brain --help` so the list can never drift from COMMANDS
//   - every skill and reference names only real CLI forms: each
//     `brain <cmd> [<sub>]` (or `npx -y brain-axi …`) must be a command and
//     subcommand that `--help` lists, and each `--flag` after it must be a
//     flag that command's `--help` lists; a code span that is just a flag
//     must be a flag some command lists
//   - numbered section references ("section 8", "`plan` §10", "section 10
//     of the `brain-plan` skill") resolve to a section that skill numbers,
//     and every wireframe class an HTML example uses is defined by the
//     brain-ux kit's CSS
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

// ---------------------------------------------------------------------------
// CLI surface: every command, its subcommands and the flags each one accepts,
// read from the CLI's own --help output (never a hand-kept list).
// ---------------------------------------------------------------------------

function helpOf(args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin", "brain.js"), ...args, "--help"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout : null;
}

// Rows of a TOON block: `subcommands[N]{name,summary}:` or `flags[N]:`.
function helpRows(text, header) {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => header.test(l));
  if (at === -1) return [];
  const rows = [];
  for (const l of lines.slice(at + 1)) {
    if (!l.startsWith("  ")) break;
    rows.push(l.trim());
  }
  return rows;
}
const flagsIn = (text) => helpRows(text, /^flags\[\d+\]:$/).map((r) => /^(--[a-z][a-z0-9-]*)/.exec(r)?.[1]).filter(Boolean);

function cliSurface(names) {
  const surface = new Map(); // cmd -> { flags:Set, subs: Map(sub -> Set flags) }
  for (const cmd of names) {
    const text = helpOf([cmd]);
    if (text === null) return { error: `bin/brain.js ${cmd} --help failed` };
    const def = /^default: brain \S+ = brain \S+ (\S+)$/m.exec(text);
    const entry = { flags: new Set(flagsIn(text)), subs: new Map(), default: def ? def[1] : null };
    for (const row of helpRows(text, /^subcommands\[\d+\]\{name,summary\}:$/)) {
      const sub = row.split(",")[0].replace(/^"|"$/g, "");
      const subText = helpOf([cmd, sub]);
      if (subText === null) return { error: `bin/brain.js ${cmd} ${sub} --help failed` };
      entry.subs.set(sub, new Set(flagsIn(subText)));
    }
    surface.set(cmd, entry);
  }
  return { surface };
}

// ---------------------------------------------------------------------------
// Command references inside skill text.
// A reference is `brain <cmd> …` or `brain-axi <cmd> …` inside a code span,
// a fenced block, or an indented command line, plus `npx -y brain-axi <cmd>`
// anywhere. Bare `brain` in prose ("the brain holds…") is never a command.
// ---------------------------------------------------------------------------

// Code regions of a markdown file: inline `spans` (which, as in CommonMark,
// may wrap across the lines of one paragraph), fenced-block lines, and
// indented command lines (4+ spaces, the skills' plain-text code style) that
// start with a brain invocation.
function codeRegions(text) {
  const out = [];
  let fenced = false;
  let cont = null; // a code line ending in `\`: the next line continues it
  let para = []; // consecutive prose lines: [{ line, lineNo }]
  const flush = () => {
    if (!para.length) return;
    const joined = para.map((p) => p.line).join("\n");
    const lineAt = (idx) => para[0].lineNo + (joined.slice(0, idx).match(/\n/g) || []).length;
    for (const m of joined.matchAll(/`([^`]+)`/g)) out.push({ text: m[1].replace(/\s*\n\s*/g, " "), lineNo: lineAt(m.index) });
    for (const m of joined.matchAll(/npx -y brain-axi(?:@[\w.]+)?((?: [^`|;&)\n]*)?)/g))
      out.push({ text: "brain-axi" + m[1], lineNo: lineAt(m.index) });
    para = [];
  };
  text.split("\n").forEach((line, i) => {
    const lineNo = i + 1;
    // Shell continuation: `brain x \` + `  --flag` is ONE command, so a flag
    // on a continuation line is checked against the command it belongs to.
    if (cont && line.trim() && !/^\s*```/.test(line)) {
      cont.text = cont.text.replace(/\\\s*$/, " ") + line.trim();
      if (!/\\\s*$/.test(line)) cont = null;
      return;
    }
    cont = null;
    if (/^\s*```/.test(line)) {
      flush();
      fenced = !fenced;
      return;
    }
    if (fenced || /^ {4,}(?:\$ )?(?:npx -y )?brain(?:-axi)?(?: |$)/.test(line)) {
      flush();
      const region = { text: line, lineNo };
      if (/\\\s*$/.test(line)) cont = region;
      return void out.push(region);
    }
    if (!line.trim()) return flush();
    para.push({ line, lineNo });
  });
  flush();
  return out;
}

// The plan artifact's CSS custom properties (brain-plan references/style.md)
// look like flags in a code span but are not CLI flags.
const CSS_VAR = /^--(?:bg|surface|fg|fg-secondary|muted|border|highlight|accent|space-[\w*-]*)$/;

const SHELL_STOP = /^(?:\||\|\||&&|;|\)|>|2>&1|#)$/;
// A token in subcommand position that is a real word, not a placeholder, path,
// quoted arg, or flag. `list|view|add` alternations are checked one by one.
const WORDISH = /^[a-z][a-z-]*(?:\|[a-z][a-z-]*)*$/;

function tokenize(s) {
  return s.match(/"[^"]*"|'[^']*'|\S+/g) || [];
}

// Every command reference in one code region: [{cmd, subs[], flags[]}].
function refsIn(region, topNames) {
  const toks = tokenize(region.replace(/[[\]]/g, " "));
  const refs = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    let start = -1;
    if ((t === "brain" || t === "brain-axi" || /^brain-axi@/.test(t)) && i + 1 < toks.length) start = i + 1;
    // The router's command map writes `features list|view …` without the
    // `brain` prefix: a region whose first token is a top-level command name
    // and that has more tokens after it is treated as a command too.
    else if (i === 0 && topNames.has(t) && toks.length > 1) start = i;
    if (start === -1) continue;
    const cmd = toks[start];
    if (!/^[a-z][a-z-]*$/.test(cmd)) continue; // `brain <cmd>`, `brain --help`
    // `map`: a bare command-map summary (`verify list|add|run [--stage …]`)
    // lists the flags of its subcommands together; a `brain …` example is run
    // as written.
    const ref = { cmd, subs: [], flags: [], map: start === i };
    let j = start + 1;
    if (j < toks.length && WORDISH.test(toks[j])) ref.subs = toks[j++].split("|");
    for (; j < toks.length; j++) {
      const tok = toks[j];
      if (SHELL_STOP.test(tok) || tok === "brain" || tok === "brain-axi") break;
      const f = /^(--[a-z][a-z0-9-]*)/.exec(tok);
      if (f) ref.flags.push(f[1]);
    }
    refs.push(ref);
    i = j - 1;
  }
  return refs;
}

function checkCommandRefs(problems, files, surface) {
  const allFlags = new Set(["--help", "--brain"]);
  for (const e of surface.values()) {
    e.flags.forEach((f) => allFlags.add(f));
    for (const s of e.subs.values()) s.forEach((f) => allFlags.add(f));
  }
  const topNames = new Set(surface.keys());
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    for (const region of codeRegions(read(file))) {
      const where = `${rel}:${region.lineNo}`;
      // A span that is only a flag (`--shot`, `--run <name>`) must be a real one.
      const lone = /^(--[a-z][a-z0-9-]*)(?:[ =].*)?$/.exec(region.text.trim());
      if (lone && !allFlags.has(lone[1]) && !CSS_VAR.test(lone[1])) problems.push(`${where}: names flag ${lone[1]}, which no brain command lists in --help`);
      for (const ref of refsIn(region.text, topNames)) {
        const entry = surface.get(ref.cmd);
        if (!entry) {
          problems.push(`${where}: names \`brain ${ref.cmd}\`, which is not a command (see \`brain --help\`)`);
          continue;
        }
        const base = [...entry.flags, "--help", "--brain"];
        // One allowed-flag set per subcommand the reference can mean: in a
        // runnable example a flag must work on EVERY named alternative
        // (`brain tasks list|claim --by` is broken for list); in a command-map
        // summary, or with no subcommand named and no default, on ANY.
        let allowedSets = [new Set(base)];
        let every = true;
        if (entry.subs.size) {
          // A word that is no subcommand of a command WITH a default is that
          // default's positional (`brain tasks auth` = `brain tasks list auth`),
          // exactly as the CLI routes it.
          if (ref.subs.length === 1 && entry.default && !entry.subs.has(ref.subs[0])) ref.subs = [];
          // No subcommand named: the CLI routes to the default one, so only its flags count.
          const subs = ref.subs.length ? ref.subs : entry.default ? [entry.default] : [...entry.subs.keys()];
          for (const s of ref.subs)
            if (!entry.subs.has(s)) problems.push(`${where}: names \`brain ${ref.cmd} ${s}\`, which is not a subcommand (\`brain ${ref.cmd} --help\` lists ${[...entry.subs.keys()].join(", ")})`);
          const known = subs.filter((s) => entry.subs.has(s)); // unknown ones are reported above
          if (known.length) allowedSets = known.map((s) => new Set([...base, ...entry.subs.get(s)]));
          every = !ref.map && (ref.subs.length > 0 || !!entry.default);
        }
        const ok = (f) => (every ? allowedSets.every((a) => a.has(f)) : allowedSets.some((a) => a.has(f)));
        for (const f of ref.flags)
          if (!ok(f))
            problems.push(`${where}: \`brain ${ref.cmd}${ref.subs.length ? " " + ref.subs.join("|") : ""}\` has no flag ${f} in --help`);
      }
    }
  }
}

function markdownFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...markdownFiles(p));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

// `references/x.md` links resolve from the skill's directory — in SKILL.md
// and in its reference files, which link each other too.
function checkReferenceLinks(problems, skillsDir = SKILLS_DIR) {
  for (const d of fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const skill = path.join(skillsDir, d.name);
    const refDir = path.join(skill, "references");
    const have = fs.existsSync(refDir) ? fs.readdirSync(refDir) : [];
    const linkers = [["SKILL.md", path.join(skill, "SKILL.md")], ...have.filter((f) => f.endsWith(".md")).map((f) => [`references/${f}`, path.join(refDir, f)])];
    for (const [rel, file] of linkers) {
      if (!fs.existsSync(file)) continue;
      for (const m of read(file).matchAll(/`references\/([A-Za-z0-9._-]+)`/g))
        if (!have.includes(m[1])) problems.push(`skills/${d.name}/${rel}: links references/${m[1]}, which does not exist`);
    }
  }
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
  }
  checkReferenceLinks(problems);
  const routerFile = path.join(SKILLS_DIR, "brain", "SKILL.md");
  if (!fs.existsSync(routerFile)) return void problems.push("skills/brain/SKILL.md: router missing");
  const cli = cliCommands();
  if (cli.error) return void problems.push(cli.error);
  const router = read(routerFile);
  for (const c of cli.names) {
    const re = new RegExp("(?:`|brain(?:-axi)? )" + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Za-z0-9-])");
    if (!re.test(router)) problems.push(`skills/brain/SKILL.md: router never names command "${c}"`);
  }
  const s = cliSurface(cli.names);
  if (s.error) return void problems.push(s.error);
  checkCommandRefs(problems, markdownFiles(SKILLS_DIR), s.surface);
}

// ---------------------------------------------------------------------------
// Section references and the wireframe kit. Skills cross-reference sections
// by number and brain-ux's HTML examples use classes its kit must define;
// both are hand-maintained prose that rots silently on a renumber. A skill
// is its SKILL.md plus its references/ (long sections live there).
// ---------------------------------------------------------------------------

function skillTexts(skillsDir) {
  const out = {};
  for (const d of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!d.isDirectory() || !d.name.startsWith("brain-")) continue;
    const file = path.join(skillsDir, d.name, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const refDir = path.join(skillsDir, d.name, "references");
    const refs = fs.existsSync(refDir) ? markdownFiles(refDir) : [];
    out[d.name.slice("brain-".length)] = [file, ...refs].map(read).join("\n");
  }
  return out;
}

// Section numbers a skill defines: "N. HEADING" / "Nb. Heading" at line
// start, "--- N.M SUBSECTION ---", and inline "… 2. TL;DR …" runs of
// upper-case section titles.
function sectionsOf(text) {
  const nums = new Set();
  for (const line of text.split("\n")) {
    let m = /^(\d+)[a-z]?\. [A-Z(]/.exec(line);
    if (m) nums.add(m[1]);
    m = /^--- (\d+)(?:\.\d+)? /.exec(line);
    if (m) nums.add(m[1]);
    for (const x of line.matchAll(/(?:^|\. )(\d+)[a-z]?\. [A-Z][A-Z;+&/ -]{2,}/g)) nums.add(x[1]);
  }
  return nums;
}

function checkGuidanceRefs(problems, skillsDir = SKILLS_DIR) {
  if (!fs.existsSync(skillsDir)) return;
  const texts = skillTexts(skillsDir);
  const ids = Object.keys(texts);
  if (!ids.length) return;
  const sections = Object.fromEntries(ids.map((id) => [id, sectionsOf(texts[id])]));
  // A number is another skill's when a backticked skill name sits just before
  // it ("`plan` §10") or after it ("section 10 of the `brain-plan` skill");
  // otherwise it is the containing skill's own.
  const NAME = String.raw`\`(?:brain-)?(${ids.join("|")})\``;
  const REF = new RegExp(
    String.raw`(?:${NAME}[^.\n]{0,40}?)?(?:§|[Ss]ection )(\d+)(?:\s+(?:of|in)\s+(?:the\s+)?${NAME})?`,
    "g"
  );
  for (const id of ids) {
    for (const m of texts[id].matchAll(REF)) {
      const target = m[3] || m[1] || id;
      if (!sections[target].has(m[2]))
        problems.push(
          `skills/brain-${id}: references ${target === id ? "" : `brain-${target} `}section ${m[2]}, which does not exist (brain-${target} numbers ${[...sections[target]].join(", ") || "none"})`
        );
    }
  }
  if (!texts.ux) return;
  const defined = new Set();
  for (const line of texts.ux.split("\n")) {
    if (!line.includes("{")) continue;
    for (const m of line.split("{")[0].matchAll(/\.(wf(?:-[a-z-]*)?|tall|short|med|primary)\b/g)) defined.add(m[1]);
  }
  if (!defined.size) return void problems.push("skills/brain-ux: the wireframe kit defines no classes — did its CSS block move?");
  for (const id of ids)
    for (const a of texts[id].matchAll(/class=["']([^"']+)["']/g))
      for (const cls of a[1].split(/\s+/))
        if (/^(?:wf|tall|short|med|primary)/.test(cls) && !defined.has(cls))
          problems.push(`skills/brain-${id}: an example uses .${cls}, which the brain-ux wireframe kit never defines`);
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

// Importable for tests (test/check-skills.test.js); runs only as a script.
export { cliCommands, cliSurface, checkCommandRefs, checkGuidanceRefs, checkReferenceLinks };

function main() {
  const found = [];
  checkSkillsTree(found);
  checkGuidanceRefs(found);
  checkPluginFiles(found);
  const problems = [...new Set(found)]; // a span can match two scanners (`npx -y brain-axi x`)
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
}

const invoked = (() => {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invoked) main();
