// Acceptance: old brain gone (plans/2026-10-10-axi-architecture.html, phase 6).
// The repo-static items of that checklist, automated so a regression (a
// markdown-era path, a cut command named in a skill, a leaked file in the npm
// tarball, a tracked .brain file) fails `node --test` and CI. Items that need
// a live brain.db, git history or a Claude session (verify run on this repo's
// brain, eval run-record renames vs the pre-axi-core base, headless
// `claude -p`, CI/Greptile) are run by hand in phase 6 and recorded with
// `brain runs append`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BIN = path.join(ROOT, "bin/brain.js");

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts });
}

const inGit = run("git", ["rev-parse", "--is-inside-work-tree"]).stdout?.trim() === "true";

// `git grep` lines (path:line:text). Exit 1 = no match; anything else is an error.
function gitGrep(pattern, paths) {
  const r = run("git", ["grep", "-nE", pattern, "--", ...paths]);
  if (r.status === 1) return [];
  assert.equal(r.status, 0, `git grep failed: ${r.stderr}`);
  return r.stdout.trim().split("\n");
}

test("git ls-files .brain prints nothing", { skip: !inGit && "not a git checkout" }, () => {
  assert.equal(run("git", ["ls-files", ".brain"]).stdout.trim(), "");
});

test("on disk, .brain holds only brain.db*, export.toon and shot images", () => {
  const dir = path.join(ROOT, ".brain");
  if (!fs.existsSync(dir)) return; // fresh clone / CI: no brain at all
  const bad = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p).split(path.sep).join("/");
      if (e.isDirectory()) walk(p);
      else if (/^brain\.db/.test(rel) || rel === "export.toon") continue;
      else if (/^shots\/.+\.(png|jpe?g|gif|webp)$/i.test(rel)) continue;
      else if (e.name === ".DS_Store") continue;
      else bad.push(rel);
    }
  };
  walk(dir);
  assert.deepEqual(bad, [], `unexpected files under .brain/: ${bad.join(", ")}`);
});

test("no shipped surface names a cut command", { skip: !inGit && "not a git checkout" }, () => {
  const hits = gitGrep(
    String.raw`(brain|brain-axi) (playbook|skill|setup|timeline|metrics|shots|receipt|brief|pr|ship|evals)\b`,
    ["skills", "bin", "lib", "hooks", ".claude-plugin", "README.md", "CLAUDE.md", "docs", ".github", "scripts", "evals-plugin"],
  );
  assert.deepEqual(hits, []);
});

// Documented exception: lib/brain/db.js's LEGACY_BRAIN detector must name the
// markdown-era marker files to recognise (and refuse) an old file brain.
const LEGACY_DETECTOR = /^lib\/brain\/db\.js:\d+:\s*fs\.existsSync\(path\.join\(brainDir, "(features", "feature_list\.json|runs", "progress\.md)"\)\)/;

test("no markdown-era .brain paths (LEGACY_BRAIN detector excepted)", { skip: !inGit && "not a git checkout" }, () => {
  const hits = gitGrep(
    String.raw`feature_list\.json|progress\.md|verify\.json|HARNESS\.md|\.brain/(rules|recipes|runs|features|plans|evals)/`,
    ["skills", "bin", "lib", "README.md", "CLAUDE.md", "docs", ".github", "scripts"],
  );
  assert.deepEqual(hits.filter((l) => !LEGACY_DETECTOR.test(l)), []);
  assert.equal(hits.length, 2, "the LEGACY_BRAIN detector should name exactly its two marker files");
});

test("old-architecture files are gone", () => {
  const gone = [
    "lib/state.js",
    "lib/review/brain-data.js",
    "lib/review/store.js",
    "lib/review/evals.js",
    "lib/review/playbooks.js",
    "scripts/check-state-invariants.mjs",
    "scripts/check-playbook-refs.mjs",
    "scripts/import-legacy-brain.mjs",
    "docs/HARNESS-INTEROP.md",
    "evals-plugin/fixtures/brain",
  ].filter((p) => fs.existsSync(path.join(ROOT, p)));
  assert.deepEqual(gone, []);
});

const ALLOW = ["bin/", "lib/", "skills/", "hooks/", ".claude-plugin/", "README.md", "CHANGELOG.md"];

test("package.json and plugin.json agree; engines node >=24; files allowlist", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin/plugin.json"), "utf8"));
  assert.equal(plugin.version, pkg.version);
  assert.equal(pkg.engines?.node, ">=24");
  assert.deepEqual(pkg.files, ALLOW);
});

const hasNpm = run("npm", ["--version"]).status === 0;

test("npm pack --dry-run ships only the allowlist", { skip: !hasNpm && "npm not on PATH" }, () => {
  const r = run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"]);
  assert.equal(r.status, 0, r.stderr);
  const files = JSON.parse(r.stdout)[0].files.map((f) => f.path);
  const stray = files.filter((f) => f !== "package.json" && !ALLOW.some((a) => (a.endsWith("/") ? f.startsWith(a) : f === a)));
  assert.deepEqual(stray, []);
  assert.ok(files.includes("bin/brain.js") && files.includes("lib/brain/migrations/001-core.sql"));
  assert.ok(files.includes("hooks/hooks.json") && files.includes("skills/brain/SKILL.md"));
});

test(".gitignore covers brain.db, -wal, -shm, .bak-v*, export.toon and shots/", () => {
  const lines = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
  for (const p of [".brain/brain.db", ".brain/brain.db-wal", ".brain/brain.db-shm", ".brain/brain.db.bak-v*", ".brain/export.toon", ".brain/shots/"])
    assert.ok(lines.includes(p), `.gitignore lacks ${p}`);
});

test("fresh repo: init → feature → tasks → runs → checkpoint → verification → ship leaves no markdown under .brain", (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "brain-accept-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => assert.equal(run("git", a, { cwd: dir }).status, 0);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "Test Author");
  fs.writeFileSync(path.join(dir, "app.js"), "console.log('ok')\n");
  git("add", "app.js");
  git("commit", "-qm", "init");
  const brain = (...a) => {
    const r = run(process.execPath, [BIN, ...a], { cwd: dir });
    assert.equal(r.status, 0, `brain ${a.join(" ")} → ${r.status}\n${r.stdout}${r.stderr}`);
    return r.stdout;
  };
  brain("init");
  brain("verify", "add", "test", "--run", "node app.js", "--stages", "baseline,verify");
  brain("verify", "run", "--stage", "baseline");
  brain("features", "add", "hello", "--name", "Hello");
  brain("features", "set", "hello", "--status", "in-progress");
  brain("tasks", "add", "hello", "--title", "print ok", "--acceptance", "prints ok");
  brain("tasks", "claim", "hello", "--by", "w1");
  brain("runs", "append", "hello", "--task", "t1", "--step", "node app.js", "--observed", "ok", "--run", "r1");
  brain("progress", "add", "--summary", "t1 walked", "--feature", "hello", "--run", "r1");
  fs.mkdirSync(path.join(dir, ".brain/shots/hello"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".brain/shots/hello/out.png"), "png");
  brain("verifications", "add", "hello", "--verdict", "PASS", "--body", "ok", "--shot", ".brain/shots/hello/out.png");
  brain("tasks", "set", "hello", "t1", "--status", "done", "--evidence", "prints ok", "--by", "w1", "--no-autoship");
  brain("features", "ship", "hello", "--evidence", "PASS round 1");
  brain("export");
  brain("check");
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(path.relative(dir, p).split(path.sep).join("/"));
    }
  };
  walk(path.join(dir, ".brain"));
  assert.deepEqual(files.filter((f) => !/^\.brain\/(brain\.db.*|export\.toon|shots\/.+\.png)$/.test(f)), []);
  assert.equal(run("git", ["status", "--porcelain", "--", ".brain"], { cwd: dir }).stdout.trim(), "", ".brain is not ignored");
});
