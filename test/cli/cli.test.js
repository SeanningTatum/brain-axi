// CLI tests: spawn bin/brain.js against temp repos. Covers the AXI contract
// (TOON + help: on every result, exit 0/1/2, unknown flags rejected, --help
// everywhere), `brain --help` listing every command (#6c), fresh init (#3,
// #10), progress --run (#9), dirty verifications (#11), refused autoship
// (#4), legacy brains, the Node gate for the SessionStart hook, and the
// export → import → export round trip.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../../bin/brain.js", import.meta.url));
const NODE22 = path.join(os.homedir(), ".nvm/versions/node/v22.14.0/bin/node");

const SURFACE = {
  init: [],
  context: [],
  export: [],
  import: [],
  features: ["list", "view", "add", "set", "ship"],
  tasks: ["list", "view", "add", "claim", "set"],
  progress: ["list", "add"],
  runs: ["view", "append"],
  docs: ["list", "view", "set", "rm"],
  plans: ["list", "view"],
  review: ["open", "poll", "end"],
  watch: [],
  verifications: ["list", "view", "add"],
  verify: ["list", "add", "run"],
  search: [],
  check: [],
};

function tmp(t, prefix = "brain-cli-") {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function gitRepo(dir) {
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "Test Author");
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  git(dir, "add", "README.md");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

// Run the CLI. Returns { code, out, err }.
function brain(cwd, args, { input, node = process.execPath, env = {} } = {}) {
  const r = spawnSync(node, [BIN, ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: { ...process.env, BRAIN_AXI_PORT: "1", BRAIN_AXI_STATE_DIR: path.join(cwd, ".review-state"), ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// Every result ends with a `help:` list (inline or block form).
function endsWithHelp(out) {
  const lines = out.trimEnd().split("\n");
  let i = lines.length - 1;
  while (i > 0 && lines[i].startsWith("  ")) i--;
  return /^help\[\d+\]:/.test(lines[i]);
}

function ok(r, re) {
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}\n${r.out}${r.err}`);
  assert.ok(endsWithHelp(r.out), `no trailing help: list\n${r.out}`);
  if (re) assert.match(r.out, re);
  return r;
}

function failsWith(r, exit, code) {
  assert.equal(r.code, exit, `expected exit ${exit}, got ${r.code}\n${r.out}${r.err}`);
  assert.match(r.out, /^error: /m);
  assert.match(r.out, new RegExp(`^code: ${code}$`, "m"));
  assert.ok(endsWithHelp(r.out), `no trailing help: list\n${r.out}`);
  return r;
}

// A git repo with an initialized brain.
function repoWithBrain(t) {
  const dir = gitRepo(tmp(t));
  ok(brain(dir, ["init"]));
  return dir;
}

test("brain --help lists exactly the documented commands (#6c)", (t) => {
  const r = ok(brain(tmp(t), ["--help"]));
  const at = r.out.split("\n").findIndex((l) => /^commands\[\d+\]\{name,summary\}:$/.test(l));
  assert.ok(at >= 0, r.out);
  const names = [];
  for (const l of r.out.split("\n").slice(at + 1)) {
    if (!l.startsWith("  ")) break;
    names.push(l.trim().split(",")[0]);
  }
  assert.deepEqual(names, Object.keys(SURFACE));
  assert.match(r.out, new RegExp(`^commands\\[${Object.keys(SURFACE).length}\\]`, "m"));
});

test("command matrix: --help on every command and subcommand, unknown flags exit 2", (t) => {
  const dir = tmp(t);
  for (const [cmd, subs] of Object.entries(SURFACE)) {
    const top = ok(brain(dir, [cmd, "--help"]), /^command: brain /m);
    if (subs.length) {
      assert.match(top.out, new RegExp(`^subcommands\\[${subs.length}\\]`, "m"), `${cmd} --help`);
      for (const sub of subs) {
        ok(brain(dir, [cmd, sub, "--help"]), new RegExp(`^command: "?brain ${cmd} ${sub}"?$`, "m"));
        failsWith(brain(dir, [cmd, sub, "--definitely-not-a-flag"]), 2, "USAGE");
      }
    } else if (cmd !== "context") failsWith(brain(dir, [cmd, "--definitely-not-a-flag"]), 2, "USAGE");
  }
});

test("usage errors exit 2: unknown command, missing arg, extra arg, flag without value", (t) => {
  const dir = repoWithBrain(t);
  failsWith(brain(dir, ["nope"]), 2, "USAGE");
  failsWith(brain(dir, ["features", "view"]), 2, "USAGE");
  failsWith(brain(dir, ["features", "view", "a", "b"]), 2, "USAGE");
  failsWith(brain(dir, ["features", "nope"]), 2, "USAGE");
  failsWith(brain(dir, ["features", "add", "x", "--name"]), 2, "USAGE");
  failsWith(brain(dir, ["features", "set", "x"]), 2, "USAGE");
  failsWith(brain(dir, ["progress", "add", "--summary", "x".repeat(201)]), 2, "SUMMARY_TOO_LONG");
});

test("fresh init: real branch + next line, no placeholder check, verify run → NO_CHECKS (#3, #10)", (t) => {
  const dir = gitRepo(tmp(t));
  const r = ok(brain(dir, ["init"]), /^ {2}branch: main$/m);
  assert.match(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), /^\.brain\/brain\.db$/m);
  const p = ok(brain(dir, ["progress", "list"]));
  assert.match(p.out, /,main,null,null,brain initialized,"declare real checks/);
  ok(brain(dir, ["verify", "list"]), /^checks\[0\]/m);
  const v = failsWith(brain(dir, ["verify", "run"]), 1, "NO_CHECKS");
  assert.match(v.out, /brain verify add/);
  failsWith(brain(dir, ["verify"]), 1, "NO_CHECKS");
  failsWith(brain(dir, ["init"]), 1, "BRAIN_EXISTS");
  assert.match(r.out, /^init:$/m);
});

test("init without git seeds branch none", (t) => {
  const dir = tmp(t);
  ok(brain(dir, ["init"]), /^ {2}branch: none$/m);
});

test("no brain.db: NO_DB exit 1 with init/import help; context silent", (t) => {
  const dir = gitRepo(tmp(t));
  const r = failsWith(brain(dir, []), 1, "NO_DB");
  assert.match(r.out, /brain init/);
  assert.match(r.out, /brain import/);
  failsWith(brain(dir, ["features", "list"]), 1, "NO_DB");
  const c = brain(dir, ["context"]);
  assert.equal(c.code, 0);
  assert.equal(c.out, "");
});

test("legacy markdown brain: LEGACY_BRAIN exit 1, init refuses, context silent", (t) => {
  const dir = gitRepo(tmp(t));
  fs.mkdirSync(path.join(dir, ".brain", "features"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".brain", "features", "feature_list.json"), '{"features":[]}\n');
  const r = failsWith(brain(dir, ["features", "list"]), 1, "LEGACY_BRAIN");
  assert.match(r.out, /brain-axi@0\.2\.0/);
  failsWith(brain(dir, ["init"]), 1, "LEGACY_BRAIN");
  const c = brain(dir, ["context"]);
  assert.equal(c.code, 0);
  assert.equal(c.out, "");
  assert.ok(!fs.existsSync(path.join(dir, ".brain", "brain.db")));
});

test("context: ≤ 600 bytes in a brain, silent outside one", (t) => {
  const dir = repoWithBrain(t);
  ok(brain(dir, ["progress", "add", "--summary", "s".repeat(200), "--next", "n".repeat(500)]));
  const c = ok(brain(dir, ["context"]), /^features: /m);
  assert.ok(Buffer.byteLength(c.out) <= 600, `${Buffer.byteLength(c.out)} bytes`);
  assert.equal(c.err, "");
  const out = brain(tmp(t), ["context"]);
  assert.equal(out.code, 0);
  assert.equal(out.out, "");
});

test("Node < 24: context exits 0 silently; other commands exit 2", { skip: !fs.existsSync(NODE22) && "node 22 not installed" }, (t) => {
  const dir = repoWithBrain(t);
  const c = brain(dir, ["context"], { node: NODE22 });
  assert.equal(c.code, 0);
  assert.equal(c.out, "");
  assert.equal(c.err, "");
  const r = brain(dir, ["features", "list"], { node: NODE22 });
  assert.equal(r.code, 2);
  assert.match(r.out, /^code: NODE_TOO_OLD$/m);
  assert.ok(endsWithHelp(r.out));
});

test("features, tasks, runs, verifications, ship: happy path and not-found", (t) => {
  const dir = repoWithBrain(t);
  ok(brain(dir, ["features", "add", "core", "--name", "Core"]));
  ok(brain(dir, ["features", "add", "auth", "--name", "Auth", "--depends-on", "core"]), /depends_on: core/);
  failsWith(brain(dir, ["features", "view", "nope"]), 1, "NOT_FOUND");
  failsWith(brain(dir, ["features", "add", "Bad Slug", "--name", "x"]), 2, "INVALID_SLUG");
  ok(brain(dir, ["features", "set", "auth", "--status", "in-progress"]), /previous: planned/);
  failsWith(brain(dir, ["features", "set", "core", "--status", "in-progress"]), 1, "ONE_IN_PROGRESS");
  failsWith(brain(dir, ["features", "set", "auth", "--status", "shipped"]), 1, "USE_SHIP");
  ok(brain(dir, ["features", "set", "auth", "--pr", "https://github.com/o/r/pull/1"]), /pr: "https:/);

  ok(brain(dir, ["tasks", "add", "auth", "--title", "form", "--acceptance", "renders"]), /key: t1/);
  ok(brain(dir, ["tasks", "add", "auth", "--title", "api", "--acceptance", "200", "--depends-on", "t1"]), /key: t2/);
  failsWith(brain(dir, ["tasks", "view", "auth", "t9"]), 1, "NOT_FOUND");
  const claim = ok(brain(dir, ["tasks", "claim", "auth", "--by", "w1"]), /task: t1/);
  assert.match(claim.out, /token: "?[0-9a-f]{16}"?$/m);
  failsWith(brain(dir, ["tasks", "set", "auth", "t1", "--status", "done", "--evidence", "ok"]), 1, "CLAIM_MISMATCH");
  ok(brain(dir, ["tasks", "set", "auth", "t1", "--status", "done", "--evidence", "ok", "--by", "w1"]), /status: done/);
  failsWith(brain(dir, ["tasks"]), 2, "USAGE");
  ok(brain(dir, ["tasks", "auth"]), /t2,open,true,api/);
  ok(brain(dir, ["tasks", "view", "auth", "t2"]), /^ready: true$/m);

  ok(brain(dir, ["runs", "append", "auth", "--task", "t2", "--step", "unit", "--observed", "ok 1"]), /n: 1/);
  ok(brain(dir, ["runs", "append", "auth", "--run", "r1", "--step", "piped", "--observed", "-"], { input: "line1\nline2\n" }), /run: r1/);
  ok(brain(dir, ["runs", "view", "auth", "--run", "r1"]), /line1\\nline2/);
  ok(brain(dir, ["runs", "auth"]), /^runs\[2\]/m);
  failsWith(brain(dir, ["runs", "view", "auth", "--run", "nope"]), 1, "NOT_FOUND");

  // Closing the last task with no verification: task done, autoship refused,
  // exit 1, hint built from the declared checks — never a hardcoded runner (#4).
  ok(brain(dir, ["verify", "add", "unit", "--run", "node -e 0", "--stages", "baseline,verify"]));
  const refused = failsWith(brain(dir, ["tasks", "set", "auth", "t2", "--status", "done", "--evidence", "green"]), 1, "SHIP_REFUSED");
  assert.match(refused.out, /unit: node -e 0/);
  assert.doesNotMatch(refused.out, /bun run/);
  ok(brain(dir, ["tasks", "view", "auth", "t2"]), /^status: done$/m);

  ok(brain(dir, ["verify", "run", "--stage", "verify"]), /^ok: true$/m);
  failsWith(brain(dir, ["verify", "run", "--only", "nope"]), 1, "NOT_FOUND");
  ok(brain(dir, ["verify", "add", "boom", "--run", "node -e 'process.exit(3)'"]));
  const bad = brain(dir, ["verify", "run", "--only", "boom"]);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /boom,fail,3/);
  assert.ok(endsWithHelp(bad.out));

  failsWith(brain(dir, ["features", "ship", "auth", "--evidence", "x"]), 1, "SHIP_REFUSED");
  fs.writeFileSync(path.join(dir, "loose.png"), "png");
  failsWith(brain(dir, ["verifications", "add", "auth", "--verdict", "PASS", "--body", "x", "--shot", "loose.png"]), 1, "SHOT_OUTSIDE_SHOTS_DIR");
  fs.mkdirSync(path.join(dir, ".brain", "shots", "auth"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".brain", "shots", "auth", "shot.png"), "png");
  const v = ok(brain(dir, ["verifications", "add", "auth", "--verdict", "PASS", "--body", "walked it", "--shot", ".brain/shots/auth/shot.png::the form"]), /verdict: PASS/);
  assert.match(v.out, /dirty: true/); // loose.png + .gitignore are uncommitted (#11)
  assert.match(v.out, /shots: 1/);
  assert.match(v.out, /commit: "?[0-9a-f]{7}/);
  failsWith(brain(dir, ["verifications", "add", "auth", "--verdict", "MAYBE", "--body", "x"]), 2, "INVALID_VERDICT");
  ok(brain(dir, ["verifications", "view", "auth"]), /shot\.png,the form/);
  ok(brain(dir, ["verifications", "list", "--feature", "auth"]), /auth,1,PASS/);
  failsWith(brain(dir, ["verifications", "view", "core"]), 1, "NOT_FOUND");

  ok(brain(dir, ["features", "ship", "auth", "--evidence", "verifier PASS round 1"]), /outcome: shipped/);
  ok(brain(dir, ["features", "ship", "auth", "--evidence", "again"]), /outcome: already-shipped/);
  ok(brain(dir, ["features", "list", "--status", "shipped"]), /auth,shipped,Auth/);
  ok(brain(dir, ["features", "view", "auth"]), /^verdict: "PASS \(round 1/m);
  ok(brain(dir, ["check"]), /^ok: true$/m);
  ok(brain(dir, []), /^in-progress: none$/m);
});

test("progress add --run links a run note; list shows it (#9)", (t) => {
  const dir = repoWithBrain(t);
  ok(brain(dir, ["features", "add", "auth", "--name", "Auth"]));
  ok(brain(dir, ["progress", "add", "--summary", "phase 1 done", "--next", "phase 2", "--feature", "auth", "--run", "2026-10-10-progress"]), /run: "?2026-10-10-progress/);
  const l = ok(brain(dir, ["progress", "list"]), /auth,"2026-10-10-progress",phase 1 done,phase 2/);
  assert.match(l.out, /brain runs view auth --run 2026-10-10-progress/);
  failsWith(brain(dir, ["progress", "add", "--summary", "x", "--run", "bad/name"]), 2, "INVALID_NAME");
  ok(brain(dir, ["progress", "add", "--summary", "y".repeat(250), "--clip"]), /…/);
  ok(brain(dir, ["progress", "add", "--summary", "body", "--body-from", "-"], { input: "detail\n" }));
  ok(brain(dir, ["progress", "list", "--full", "--limit", "1"]), /"detail\\n"/);
});

test("docs + search: set from file and stdin, view, rm, FTS hit", (t) => {
  const dir = repoWithBrain(t);
  fs.writeFileSync(path.join(dir, "r.md"), "# Testing rule\n\nAlways run the zebra suite.\n");
  ok(brain(dir, ["docs", "set", "rules", "testing", "--from", "r.md"]), /created: true/);
  ok(brain(dir, ["docs", "set", "recipes/deploy"], { input: "# Deploy\n\nsteps\n" }), /doc: recipes\/deploy/);
  failsWith(brain(dir, ["docs", "set", "nope", "x", "--from", "r.md"]), 2, "INVALID_SECTION");
  failsWith(brain(dir, ["docs", "set", "rules", "x", "--from", "missing.md"]), 1, "NOT_FOUND");
  ok(brain(dir, ["docs", "view", "rules/testing"]), /zebra/);
  ok(brain(dir, ["docs"]), /^docs\[2\]/m);
  ok(brain(dir, ["search", "zebra"]), /doc,rules\/testing/);
  ok(brain(dir, ["search", "nothing", "matches", "this"]), /^results\[0\]/m);
  ok(brain(dir, ["docs", "rm", "rules", "testing"]), /removed: true/);
  failsWith(brain(dir, ["docs", "view", "rules", "testing"]), 1, "NOT_FOUND");
});

test("plans + review end --approved-by work headless (no server) (#8)", (t) => {
  const dir = repoWithBrain(t);
  fs.mkdirSync(path.join(dir, "plans"));
  fs.writeFileSync(path.join(dir, "plans", "p.html"), "<title>My plan</title><p>x</p>");
  ok(brain(dir, ["plans"]), /^plans\[0\]/m);
  const e = ok(brain(dir, ["review", "end", "plans/p.html", "--approved-by", "sean"]), /status: approved/);
  assert.match(e.out, /approved_round: 1/);
  ok(brain(dir, ["plans", "list"]), /p,approved,1/);
  ok(brain(dir, ["plans", "view", "p"]), /^title: My plan$/m);
  failsWith(brain(dir, ["plans", "view", "nope"]), 1, "NOT_FOUND");
  failsWith(brain(dir, ["review", "open", "plans/missing.html"]), 1, "NOT_FOUND");
  failsWith(brain(dir, ["watch", "nope"]), 1, "NOT_FOUND");
  ok(brain(dir, ["review", "poll", "plans/p.html", "--timeout-ms", "2000"]), /^status: missing$/m);
  ok(brain(dir, ["check"]), /^ok: true$/m);
});

test("export → import → export is byte-identical; import refuses a non-empty brain", (t) => {
  const src = repoWithBrain(t);
  ok(brain(src, ["features", "add", "auth", "--name", "Auth, with \"quotes\"", "--description", "multi\nline"]));
  ok(brain(src, ["docs", "set", "rules", "r"], { input: "# R\n\nbody: with, punctuation\n" }));
  ok(brain(src, ["runs", "append", "auth", "--step", "s", "--observed", "tab\there"]));
  const ex = ok(brain(src, ["export"]), /file: .brain\/export\.toon/);
  assert.match(ex.out, /features,1/);
  const d1 = brain(src, ["export", "--stdout"]);
  assert.equal(d1.code, 0);
  assert.equal(d1.out, fs.readFileSync(path.join(src, ".brain", "export.toon"), "utf8"));

  const dst = gitRepo(tmp(t));
  fs.writeFileSync(path.join(dst, "dump.toon"), d1.out);
  ok(brain(dst, ["import", "dump.toon"]), /created: true/);
  const d2 = brain(dst, ["export", "--stdout"]);
  assert.equal(d2.out, d1.out);
  failsWith(brain(dst, ["import", "dump.toon"]), 1, "IMPORT_NOT_EMPTY");

  const viaStdin = gitRepo(tmp(t));
  ok(brain(viaStdin, ["import", "-"], { input: d1.out }));
  assert.equal(brain(viaStdin, ["export", "--stdout"]).out, d1.out);

  const bad = gitRepo(tmp(t));
  failsWith(brain(bad, ["import", "-"], { input: "nope\n" }), 1, "IMPORT_PARSE");
  assert.ok(!fs.existsSync(path.join(bad, ".brain", "brain.db")), "a failed import leaves no brain.db behind");
});

test("stdout carries no stderr noise on success; diagnostics go to stderr", (t) => {
  const dir = repoWithBrain(t);
  ok(brain(dir, ["verify", "add", "t", "--run", "node -e 0"]));
  const r = ok(brain(dir, ["verify", "run"]));
  assert.match(r.err, /^pass t /m);
  assert.doesNotMatch(r.out, /^pass t /m);
});
