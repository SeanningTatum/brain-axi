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
import { fileURLToPath, pathToFileURL } from "node:url";

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

test("init / import --brain <dir> create brain.db in that directory, whatever its name", (t) => {
  const dir = gitRepo(tmp(t));
  ok(brain(dir, ["init", "--brain", "custom-brain"]), /brain: custom-brain/);
  assert.ok(fs.existsSync(path.join(dir, "custom-brain", "brain.db")));
  assert.ok(!fs.existsSync(path.join(dir, ".brain")), "no stray .brain/");
  ok(brain(dir, ["features", "add", "a", "--name", "A", "--brain", "custom-brain"]));
  const dump = brain(dir, ["export", "--stdout", "--brain", "custom-brain"]).out;
  ok(brain(dir, ["import", "-", "--brain", "other-brain"], { input: dump }), /created: true/);
  assert.ok(fs.existsSync(path.join(dir, "other-brain", "brain.db")));
  assert.ok(!fs.existsSync(path.join(dir, ".brain")), "no stray .brain/");
});

test("every help: command keeps a custom --brain (Greptile r8: feature add hints dropped it)", (t) => {
  const dir = gitRepo(tmp(t));
  ok(brain(dir, ["init", "--brain", "my brain"]));
  const helpOf = (out) => out.slice(out.search(/^help\[/m)).split("\n").slice(1).filter((l) => l.startsWith("  "));
  const add = ok(brain(dir, ["features", "add", "auth", "--name", "Auth", "--brain", "my brain"])).out;
  const hints = helpOf(add);
  assert.equal(hints.length, 3, add);
  for (const h of hints) assert.match(h, /: brain .* --brain 'my brain'$/, h);
  // Backticked commands get it inside the span; an error's hints too.
  ok(brain(dir, ["features", "view", "auth", "--brain", "my brain"]), /Start it: brain features set auth --status in-progress --brain 'my brain'$/m);
  const miss = brain(dir, ["features", "--brain", "no brain"]);
  assert.equal(miss.code, 1, miss.out);
  assert.match(miss.out, /Run `brain init --brain 'no brain'` to create one/);
  assert.match(miss.out, /`brain import <file> --brain 'no brain'`/);
  // Without --brain nothing is added.
  assert.doesNotMatch(ok(brain(dir, ["features", "--brain", "my brain"])).out.replace(/--brain 'my brain'/g, ""), /--brain/);
  // Free-text values are single-quoted: a claim holder with a space, and a
  // brain dir with shell metacharacters, paste back as one literal word.
  ok(brain(dir, ["tasks", "add", "auth", "--title", "T", "--acceptance", "A", "--brain", "my brain"]));
  const claim = ok(brain(dir, ["tasks", "claim", "auth", "--by", "Jane Doe", "--brain", "my brain"])).out;
  assert.match(claim, /--status done --evidence "\.\.\." --by 'Jane Doe' --brain 'my brain'$/m);
  assert.match(claim, /--status open --by 'Jane Doe' --brain 'my brain'$/m);
  ok(brain(dir, ["init", "--brain", "b$x`y"]));
  ok(brain(dir, ["features", "add", "z", "--name", "Z", "--brain", "b$x`y"]), /--brain 'b\$x`y'$/m);
  assert.doesNotMatch(brain(dir, ["features", "add", "x", "--name", "X"]).out, /--brain/);
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

test("init --brain under directories that do not exist yet creates them", (t) => {
  const dir = gitRepo(tmp(t));
  ok(brain(dir, ["init", "--brain", "state/nested/.brain"]), /^ {2}brain: state\/nested\/\.brain$/m);
  assert.ok(fs.existsSync(path.join(dir, "state", "nested", ".brain", "brain.db")));
  ok(brain(dir, ["features", "--brain", "state/nested/.brain"]));
});

test("plans view: clipped prompts point at --full", async (t) => {
  const dir = repoWithBrain(t);
  fs.mkdirSync(path.join(dir, "plans"));
  fs.writeFileSync(path.join(dir, "plans", "p.html"), "<title>P</title><p>x</p>");
  const { openBrain, plans, close } = await import("../../lib/brain/index.js");
  const b = openBrain(dir);
  plans.upsert(b.db, { file: "plans/p.html", root: dir });
  plans.addRound(b.db, "p", { prompts: [{ tag: "message", prompt: "short" }], root: dir });
  close(b.db);
  assert.doesNotMatch(ok(brain(dir, ["plans", "view", "p"])).out, /--full/);
  const b2 = openBrain(dir);
  plans.addRound(b2.db, "p", { prompts: [{ tag: "message", prompt: "long ".repeat(100) + "THE END" }], root: dir });
  close(b2.db);
  const v = ok(brain(dir, ["plans", "view", "p"]), /Prompts cut at 160 chars \(…\): brain plans view p --full/);
  assert.doesNotMatch(v.out, /THE END/);
  assert.doesNotMatch(ok(brain(dir, ["plans", "view", "p", "--full"]), /THE END/).out, /Prompts cut/);
  // The reopen hint resolves from the caller's directory, not the repo root.
  ok(brain(dir, ["plans", "view", "p"]), /Reopen it for review: brain review open plans\/p\.html/);
  ok(brain(path.join(dir, "plans"), ["plans", "view", "p"]), /Reopen it for review: brain review open p\.html/);
  // A custom brain stays selected in both hints.
  const custom = ok(brain(dir, ["plans", "view", "p", "--brain", ".brain"])).out;
  assert.match(custom, /Reopen it for review: brain review open plans\/p\.html --brain \.brain$/m);
  assert.match(custom, /brain plans view p --full --brain \.brain$/m);
});

test("review: a symlinked alias of a registered plan is the same plan; hints keep --brain/--port", (t) => {
  const dir = repoWithBrain(t);
  fs.mkdirSync(path.join(dir, "plans"));
  fs.writeFileSync(path.join(dir, "plans", "p.html"), "<title>P</title><p>x</p>");
  fs.symlinkSync("p.html", path.join(dir, "plans", "alias.html"));
  ok(brain(dir, ["review", "end", "plans/p.html", "--approved-by", "sean"]), /status: approved/);
  ok(brain(dir, ["review", "end", "plans/alias.html", "--approved-by", "sean"]), /plan: p$/m);
  ok(brain(dir, ["plans", "list"]), /^plans\[1\]/m);
  const r = ok(brain(dir, ["review", "poll", "plans/p.html", "--timeout-ms", "2000", "--brain", ".brain", "--port", "1"]), /^status: missing$/m);
  assert.match(r.out, /brain review open plans\/p\.html --brain \.brain --port 1/);
});

test("verifications add --help names the brain's own shots dir for custom --brain dirs", () => {
  const r = brain(os.tmpdir(), ["verifications", "add", "--help"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /<brainDir>\/shots\/ with --brain/);
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

  // The PASS was dirty: the ship still happens, with a warning + re-verify help.
  const shipped = ok(brain(dir, ["features", "ship", "auth", "--evidence", "verifier PASS round 1"]), /outcome: shipped/);
  assert.match(shipped.out, /^warning: "?PASS verification \(round 1\) was recorded on a dirty tree/m);
  assert.match(shipped.out, /Re-verify on the current HEAD: run the brain-verify skill/);
  const again = ok(brain(dir, ["features", "ship", "auth", "--evidence", "again"]), /outcome: already-shipped/);
  assert.doesNotMatch(again.out, /^warning:/m);
  ok(brain(dir, ["features", "list", "--status", "shipped"]), /auth,shipped,Auth/);
  ok(brain(dir, ["features", "view", "auth"]), /^verdict: "PASS \(round 1/m);
  ok(brain(dir, ["check"]), /^ok: true$/m);
  ok(brain(dir, []), /^in-progress: none$/m);
});

test("ship warns (never refuses) when the PASS commit is not in HEAD; a clean PASS on HEAD ships silently; autoship too", (t) => {
  const dir = repoWithBrain(t);
  git(dir, "add", ".gitignore");
  git(dir, "commit", "-q", "-m", "ignore brain");
  ok(brain(dir, ["features", "add", "clean", "--name", "Clean"]));
  ok(brain(dir, ["verifications", "add", "clean", "--verdict", "PASS", "--body", "walked"]), /dirty: false/);
  const c = ok(brain(dir, ["features", "ship", "clean", "--evidence", "PASS round 1"]), /outcome: shipped/);
  assert.doesNotMatch(c.out, /warning|Re-verify/);

  // Verified on a side branch that never lands in main's history (squash-merge shape).
  ok(brain(dir, ["features", "add", "side", "--name", "Side", "--status", "in-progress"]));
  ok(brain(dir, ["tasks", "add", "side", "--title", "one", "--acceptance", "works"]));
  git(dir, "checkout", "-q", "-b", "side");
  fs.writeFileSync(path.join(dir, "side.txt"), "x\n");
  git(dir, "add", "side.txt");
  git(dir, "commit", "-q", "-m", "side");
  ok(brain(dir, ["verifications", "add", "side", "--verdict", "PASS", "--body", "walked"]), /dirty: false/);
  git(dir, "checkout", "-q", "main");
  const r = ok(brain(dir, ["tasks", "set", "side", "t1", "--status", "done", "--evidence", "works"]), /^ship:$/m);
  assert.match(r.out, /^  outcome: shipped$/m);
  assert.match(r.out, /^warning: "?PASS verification \(round 1\) was taken on [0-9a-f]+, which is not an ancestor of HEAD [0-9a-f]+"?$/m);
  assert.match(r.out, /Re-verify on the current HEAD/);
  assert.ok(endsWithHelp(r.out));
});

test("worktree: --shot lands in the main checkout's .brain/shots/; check passes from both checkouts and after removal", (t) => {
  const base = tmp(t);
  const main = path.join(base, "main");
  fs.mkdirSync(main);
  gitRepo(main);
  ok(brain(main, ["init"]));
  ok(brain(main, ["features", "add", "auth", "--name", "Auth"]));
  const wt = path.join(base, "wt");
  git(main, "worktree", "add", "-q", wt, "-b", "wt-branch");
  const mainShots = path.join(main, ".brain", "shots", "auth");

  // The worktree's own .brain/shots/ is refused; the help names the main dir.
  fs.mkdirSync(path.join(wt, ".brain", "shots", "auth"), { recursive: true });
  fs.writeFileSync(path.join(wt, ".brain", "shots", "auth", "own.png"), "png");
  const refused = failsWith(brain(wt, ["verifications", "add", "auth", "--verdict", "PASS", "--body", "x", "--shot", ".brain/shots/auth/own.png"]), 1, "SHOT_OUTSIDE_SHOTS_DIR");
  assert.ok(refused.out.includes(mainShots + "/"), refused.out);

  fs.mkdirSync(mainShots, { recursive: true });
  fs.writeFileSync(path.join(mainShots, "form.png"), "png");
  ok(brain(wt, ["verifications", "add", "auth", "--verdict", "PASS", "--body", "walked it", "--shot", path.join(mainShots, "form.png") + "::the form"]), /shots: 1/);
  ok(brain(wt, ["verifications", "view", "auth"]), /\.brain\/shots\/auth\/form\.png,the form/);
  ok(brain(wt, ["check"]), /^ok: true$/m);
  ok(brain(main, ["check"]), /^ok: true$/m);
  git(main, "worktree", "remove", "--force", wt);
  ok(brain(main, ["check"]), /^ok: true$/m);
});

test("init from a worktree records the worktree's branch, not the main checkout's", (t) => {
  const base = tmp(t);
  const main = path.join(base, "main");
  fs.mkdirSync(main);
  gitRepo(main);
  const wt = path.join(base, "wt");
  git(main, "worktree", "add", "-q", wt, "-b", "wt-branch");
  ok(brain(wt, ["init"]), /^ {2}branch: wt-branch$/m);
  ok(brain(main, ["progress", "list"]), /wt-branch/);
  git(main, "worktree", "remove", "--force", wt);
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
  // Extra path parts are refused, never truncated onto another doc.
  failsWith(brain(dir, ["docs", "rm", "rules/testing/extra"]), 2, "USAGE");
  ok(brain(dir, ["docs", "view", "rules/testing"]), /zebra/);
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

test("export replaces --out atomically: a failed write leaves the previous backup intact (Greptile r8)", (t) => {
  const src = repoWithBrain(t);
  ok(brain(src, ["features", "add", "auth", "--name", "Auth"]));
  const dir = path.join(src, "backups");
  fs.mkdirSync(dir);
  const out = path.join(dir, "b.toon");
  ok(brain(src, ["export", "--out", "backups/b.toon"]));
  const first = fs.readFileSync(out, "utf8");
  assert.match(first, /^format: brain-export$/m);
  assert.deepEqual(fs.readdirSync(dir), ["b.toon"], "no temp file left behind");
  ok(brain(src, ["features", "add", "billing", "--name", "Billing"]));
  fs.chmodSync(dir, 0o555); // the dump cannot be written beside the backup
  let r;
  try {
    r = brain(src, ["export", "--out", "backups/b.toon"]);
  } finally {
    fs.chmodSync(dir, 0o755);
  }
  assert.equal(r.code, 1, r.out);
  assert.equal(fs.readFileSync(out, "utf8"), first, "the previous backup is untouched");
  ok(brain(src, ["export", "--out", "backups/b.toon"]));
  assert.match(fs.readFileSync(out, "utf8"), /billing/);
  // A symlinked --out keeps pointing at the file it names.
  fs.symlinkSync("b.toon", path.join(dir, "latest.toon"));
  ok(brain(src, ["export", "--out", "backups/latest.toon"]));
  assert.ok(fs.lstatSync(path.join(dir, "latest.toon")).isSymbolicLink());
  // Replacing a private backup keeps it private (Greptile PR #24 r1).
  fs.chmodSync(out, 0o600);
  ok(brain(src, ["export", "--out", "backups/b.toon"]));
  assert.equal(fs.statSync(out).mode & 0o777, 0o600, "existing backup mode preserved");
});

test("export → import → export is byte-identical; import refuses a non-empty brain", (t) => {
  const src = repoWithBrain(t);
  ok(brain(src, ["features", "add", "auth", "--name", "Auth, with \"quotes\"", "--description", "multi\nline"]));
  ok(brain(src, ["docs", "set", "rules", "r"], { input: "# R\n\nbody: with, punctuation\n" }));
  ok(brain(src, ["runs", "append", "auth", "--step", "s", "--observed", "tab\there"]));
  // The dump never overwrites the live database or its WAL/SHM.
  const live = fs.readFileSync(path.join(src, ".brain", "brain.db"));
  failsWith(brain(src, ["export", "--out", ".brain/brain.db"]), 2, "USAGE");
  failsWith(brain(src, ["export", "--out", ".brain/brain.db-wal"]), 2, "USAGE");
  fs.symlinkSync(path.join(src, ".brain", "brain.db"), path.join(src, "alias.db"));
  failsWith(brain(src, ["export", "--out", "alias.db"]), 2, "USAGE");
  fs.linkSync(path.join(src, ".brain", "brain.db"), path.join(src, "hard.db")); // same inode, different realpath
  failsWith(brain(src, ["export", "--out", "hard.db"]), 2, "USAGE");
  assert.ok(fs.readFileSync(path.join(src, ".brain", "brain.db")).subarray(0, 16).equals(live.subarray(0, 16)), "brain.db untouched");
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
  // A failure after parsing (schema too new) also leaves nothing: the import
  // ran in a private staging dir, removed without touching .brain/brain.db.
  failsWith(brain(bad, ["import", "-"], { input: d1.out.replace(/^schema: \d+$/m, "schema: 999") }), 1, "IMPORT_VERSION");
  assert.deepEqual(fs.readdirSync(path.join(bad, ".brain")), [], "no brain.db and no staging dir left");
  ok(brain(dst, ["check"]), /^ok: true$/m);
  assert.ok(!fs.readdirSync(path.join(dst, ".brain")).some((n) => n.startsWith(".import-")), "staging dir removed after success");
});

// A preload module (via NODE_OPTIONS=--import) that runs inside the CLI process.
function preload(t, body) {
  const file = path.join(tmp(t, "brain-preload-"), "preload.mjs");
  fs.writeFileSync(file, body);
  return { NODE_OPTIONS: `--import=${pathToFileURL(file).href}` };
}

test("export creates its temp file exclusively: a symlink planted at the temp name is never followed (Greptile r8)", (t) => {
  const dir = repoWithBrain(t);
  const victim = path.join(dir, "victim.txt");
  fs.writeFileSync(victim, "precious\n");
  // Plant symlinks at every temp name the old code could use (its pid-only name).
  const env = preload(t, `import fs from "node:fs";
fs.symlinkSync(${JSON.stringify(victim)}, ${JSON.stringify(path.join(dir, ".brain"))} + "/.export.toon.tmp-" + process.pid);
`);
  ok(brain(dir, ["export"], { env }), /file: .brain\/export\.toon/);
  assert.equal(fs.readFileSync(victim, "utf8"), "precious\n", "the symlink target is untouched");
  assert.ok(!fs.lstatSync(path.join(dir, ".brain", "export.toon")).isSymbolicLink(), "export.toon is a regular file");
  assert.match(fs.readFileSync(path.join(dir, ".brain", "export.toon"), "utf8"), /^features\[/m);
  assert.ok(!fs.readdirSync(path.join(dir, ".brain")).some((n) => /^\.export\.toon\.tmp-.*-[0-9a-f]+$/.test(n)), "no temp file left behind");
});

test("export's restore hint names an absolute path, never a quoted ~/ (Greptile r8)", (t) => {
  const home = tmp(t, "brain-home-");
  const dir = repoWithBrain(t);
  const out = path.join(home, "my backup.toon");
  const r = ok(brain(dir, ["export", "--out", out], { env: { HOME: home } }));
  assert.match(r.out, /file: "?~\/my backup\.toon/, "display may shorten to ~");
  const hint = r.out.split("\n").find((l) => l.includes("brain import"));
  assert.ok(hint.includes(`brain import '${out}'`), hint);
  assert.doesNotMatch(hint, /'~/);
});

test("a fresh import writes .gitignore before publishing brain.db; a failed write leaves no brain.db (Greptile r8)", (t) => {
  const src = repoWithBrain(t);
  const dump = brain(src, ["export", "--stdout"]).out;
  const dst = gitRepo(tmp(t));
  fs.mkdirSync(path.join(dst, ".gitignore")); // unwritable as a file
  const r = brain(dst, ["import", "-"], { input: dump });
  assert.notEqual(r.code, 0, r.out + r.err);
  assert.ok(!fs.existsSync(path.join(dst, ".brain", "brain.db")), "brain.db was not published un-ignored");
  assert.ok(!fs.readdirSync(path.join(dst, ".brain")).some((n) => n.startsWith(".import-")), "staging dir removed");
});

test("a fresh import falls back to an exclusive copy where hard links are unsupported (Greptile r8)", (t) => {
  const src = repoWithBrain(t);
  const dump = brain(src, ["export", "--stdout"]).out;
  const env = preload(t, `import fs from "node:fs";
fs.linkSync = () => { throw Object.assign(new Error("EPERM: operation not permitted, link"), { code: "EPERM" }); };
`);
  const dst = gitRepo(tmp(t));
  ok(brain(dst, ["import", "-"], { input: dump, env }), /created: true/);
  assert.equal(brain(dst, ["export", "--stdout"]).out, dump);
  assert.match(fs.readFileSync(path.join(dst, ".gitignore"), "utf8"), /\.brain\/brain\.db/);
  // Still no-clobber: a brain.db made meanwhile is refused, not replaced.
  const raced = gitRepo(tmp(t));
  const racer = preload(t, `import fs from "node:fs";
const copy = fs.copyFileSync;
fs.linkSync = () => { throw Object.assign(new Error("EPERM"), { code: "EPERM" }); };
fs.copyFileSync = (a, b, m) => { if (String(b).endsWith("brain.db")) fs.writeFileSync(b, "theirs"); return copy(a, b, m); };
`);
  failsWith(brain(raced, ["import", "-"], { input: dump, env: racer }), 1, "BRAIN_EXISTS");
  assert.equal(fs.readFileSync(path.join(raced, ".brain", "brain.db"), "utf8"), "theirs");
});

test("argv: `--` ends flag parsing; an inherited property is not a subcommand (exit 2)", (t) => {
  const dir = repoWithBrain(t);
  ok(brain(dir, ["docs", "set", "rules", "flags"], { input: "# Flags\n\nuse --help-me carefully\n" }));
  const r = ok(brain(dir, ["search", "--", "--help-me"]), /^query: "?--help-me"?$/m);
  assert.doesNotMatch(r.out, /^command: /m, "searched, not help");
  failsWith(brain(dir, ["features", "toString"]), 2, "USAGE");
  failsWith(brain(dir, ["tasks", "constructor"]), 1, "NOT_FOUND"); // `tasks list constructor`: a feature slug, not INTERNAL
});

test("context stays ≤ 600 bytes even when the brain path alone is longer", (t) => {
  let deep = tmp(t);
  // ~480-char brain path: under SQLite's 512-byte path limit, over the cap's budget.
  for (let i = 0; i < 4; i++) deep = path.join(deep, `${"d".repeat(99)}${i}`);
  fs.mkdirSync(deep, { recursive: true });
  ok(brain(deep, ["init"]));
  const outside = tmp(t);
  const c = ok(brain(outside, ["context", "--brain", path.join(deep, ".brain")]), /^brain: "?…/m);
  assert.ok(Buffer.byteLength(c.out) <= 600, `${Buffer.byteLength(c.out)} bytes`);
  assert.match(c.out, /\.brain"?$/m);
  assert.ok(endsWithHelp(c.out));
});

test("stdout carries no stderr noise on success; diagnostics go to stderr", (t) => {
  const dir = repoWithBrain(t);
  ok(brain(dir, ["verify", "add", "t", "--run", "node -e 0"]));
  const r = ok(brain(dir, ["verify", "run"]));
  assert.match(r.err, /^pass t /m);
  assert.doesNotMatch(r.out, /^pass t /m);
});
