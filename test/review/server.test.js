// The review server end to end, no browser: the CLI spawns a real server on a
// free port against a temp brain.db; the test plays the browser over HTTP.
// Covers the review round trip (open → feedback → poll → agent-reply → end
// --approved-by), the user-end path, the same-origin guard, the watch routes
// (context, shots, pins) and the SSE nudge when the CLI writes brain.db.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../../bin/brain.js", import.meta.url));

function tmp(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "brain-review-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// The `url:` field of a TOON group (quoted when it carries ":" or "?").
const urlOf = (out) => /^ {2}url: "?([^"\s]+)"?$/m.exec(out)[1];

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}

// A git repo with a fresh brain, an in-progress feature `auth`, a plan file,
// and a review server environment (port + state dir) shut down after the test.
async function setup(t) {
  const dir = tmp(t);
  const state = path.join(dir, ".review-state");
  const port = await freePort();
  const env = { ...process.env, BRAIN_AXI_PORT: String(port), BRAIN_AXI_STATE_DIR: state, BRAIN_AXI_IDLE_TIMEOUT_MS: "60000", BRAIN_AXI_DB_POLL_MS: "200" };
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "Test Author");
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  git(dir, "add", "README.md");
  git(dir, "commit", "-q", "-m", "init");
  const brain = (args) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { cwd: dir, env, encoding: "utf8", timeout: 20000 });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const ok = (r, re) => {
    assert.equal(r.code, 0, `exit ${r.code}\n${r.out}\n${r.err}`);
    if (re) assert.match(r.out, re);
    return r;
  };
  ok(brain(["init"]));
  ok(brain(["features", "add", "auth", "--name", "Auth"]));
  ok(brain(["features", "set", "auth", "--status", "in-progress"]));
  fs.mkdirSync(path.join(dir, "plans"));
  fs.writeFileSync(path.join(dir, "plans", "auth.html"), "<!doctype html><title>Auth plan</title><body><h1>Plan</h1><p>Use passkeys for login everywhere.</p></body>");
  const base = `http://127.0.0.1:${port}`;
  t.after(() => fetch(`${base}/shutdown`, { method: "POST" }).catch(() => {}));
  const post = (p, body, headers = {}) =>
    fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { dir, port, base, brain, ok, post, brainDir: path.join(dir, ".brain") };
}

test("review round trip: open → feedback → poll records a round → reply → end --approved-by", async (t) => {
  const { base, brain, ok, post } = await setup(t);

  const open = ok(brain(["review", "open", "plans/auth.html", "--feature", "auth", "--no-open"]), /^session:$/m);
  assert.match(open.out, /^ {2}plan: auth$/m);
  assert.match(open.out, /^ {2}feature: auth$/m);
  const url = urlOf(open.out);
  const key = url.split("/").pop();
  ok(brain(["plans", "view", "auth"]), /^status: draft$/m);
  ok(brain([]), /review-sessions\[1\]/);

  // The artifact is served with the SDK injected and the CSP header.
  const art = await fetch(`${base}/session/${key}/artifact`);
  assert.equal(art.status, 200);
  assert.match(art.headers.get("content-security-policy"), /script-src 'self' 'unsafe-inline'/);
  assert.match(await art.text(), new RegExp(`<script src="/session/${key}/sdk.js" data-brain-ui></script></body>`));

  // Sidebar context comes from brain.db.
  let ctx = await (await fetch(`${base}/session/${key}/context`)).json();
  assert.equal(ctx.plan.title, "Auth plan");
  assert.equal(ctx.plan.rounds, 0);
  assert.equal(ctx.execution.feature.status, "in-progress");
  assert.match(ctx.execution.watch_url, /^\/watch\/auth\?brain=/);
  assert.deepEqual(ctx.features.in_progress, ["auth"]);
  const health = await (await fetch(`${base}/session/${key}/health`)).json();
  assert.ok(health.checks.some((c) => c.check === "sqlite integrity" && c.status === "pass"));

  // A cross-origin page cannot queue prompts.
  const evil = await post("/api/feedback", { key, prompts: [{ prompt: "x" }] }, { origin: "http://evil.example" });
  assert.equal(evil.status, 403);

  // The browser queues a decision exactly as window.brain.queuePrompt does.
  const fb = await post(
    "/api/feedback",
    { key, prompts: [{ tag: "decision", queueKey: "c1", prompt: "Login: passkeys", text: "Use passkeys for login everywhere.", target: { type: "decision", question: "Login", choice: "passkeys" } }] },
    { origin: base }
  );
  assert.deepEqual(await fb.json(), { ok: true, queued: 1 });

  // The poll returns it (with a server-resolved line) and records round 1.
  const poll = ok(brain(["review", "poll", "plans/auth.html", "--timeout-ms", "5000"]), /^status: feedback$/m);
  assert.match(poll.out, /^prompts\[1\]\{tag,line,selector,text,prompt\}:$/m);
  assert.match(poll.out, /decision,1,"",Use passkeys for login everywhere\.,"Login: passkeys"/);
  let view = ok(brain(["plans", "view", "auth"]), /^status: in-review$/m);
  assert.match(view.out, /^rounds\[1\]/m);
  assert.match(view.out, /Login: passkeys/);
  ctx = await (await fetch(`${base}/session/${key}/context`)).json();
  assert.equal(ctx.reviews.length, 1);
  assert.equal(ctx.reviews[0].prompts[0].target.choice, "passkeys");

  // An agent reply lands in the chat; nothing queued, so the poll times out.
  ok(brain(["review", "poll", "plans/auth.html", "--agent-reply", "switched to passkeys", "--timeout-ms", "1200"]), /^status: timeout$/m);

  // Headless approval: round 2 ended by the approver, session closed.
  const end = ok(brain(["review", "end", "plans/auth.html", "--approved-by", "sean"]), /^ {2}status: approved$/m);
  assert.match(end.out, /^ {2}approved_round: 2$/m);
  assert.match(end.out, /^ {2}server_session: ended$/m);
  view = ok(brain(["plans", "view", "auth"]), /^status: approved$/m);
  assert.match(view.out, /^rounds\[2\]/m);
  assert.match(view.out, /^ {2}2,\S+,sean,0$/m);
  ok(brain(["review", "poll", "plans/auth.html", "--timeout-ms", "3000"]), /^status: ended$/m);
  const home = ok(brain([]));
  assert.doesNotMatch(home.out, /review-sessions/);
  ok(brain(["check"]), /^ok: true$/m);
});

test("review: a user end with feedback records the closing round; the latch refuses a plain reopen", async (t) => {
  const { base, brain, ok, post } = await setup(t);
  const open = ok(brain(["review", "open", "plans/auth.html", "--no-open"]));
  const key = urlOf(open.out).split("/").pop();
  const fb = await post("/api/feedback", { key, end: true, prompts: [{ tag: "message", prompt: "ship it" }] }, { origin: base });
  assert.equal(fb.status, 200);
  const poll = ok(brain(["review", "poll", "plans/auth.html", "--timeout-ms", "5000"]), /^status: feedback$/m);
  assert.match(poll.out, /^ended_by: user$/m);
  const view = ok(brain(["plans", "view", "auth"]), /^status: reviewed$/m);
  assert.match(view.out, /^ {2}1,\S+,user,1$/m);
  ok(brain(["plans", "list"]), /auth,reviewed,1/);
  assert.doesNotMatch(ok(brain([])).out, /review-sessions/);
  ok(brain(["review", "open", "plans/auth.html", "--no-open"]), /^refused: /m);
  ok(brain(["review", "open", "plans/auth.html", "--no-open", "--reopen"]), /^ {2}status: open$/m);
  // An unknown feature is refused by the CLI before the server is asked.
  const bad = brain(["review", "open", "plans/auth.html", "--feature", "ghost", "--no-open"]);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /^code: NOT_FOUND$/m);
});

test("watch: context, recorded shots only, pins, and a context-update when the CLI writes", async (t) => {
  const { dir, base, brain, ok, post, brainDir } = await setup(t);
  fs.mkdirSync(path.join(brainDir, "shots"), { recursive: true });
  fs.writeFileSync(path.join(brainDir, "shots", "01-login.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  ok(brain(["runs", "append", "auth", "--run", "r1", "--step", "boot", "--observed", "listening on 3000"]));
  ok(brain(["verifications", "add", "auth", "--verdict", "PASS", "--body", "walked login", "--shot", ".brain/shots/01-login.png"]));

  const w = ok(brain(["watch", "auth", "--no-open"]), /^watch:$/m);
  const url = urlOf(w.out);
  const qs = url.slice(url.indexOf("?"));
  assert.equal(decodeURIComponent(qs.slice("?brain=".length)), brainDir);

  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /auth/);
  const ctx = await (await fetch(`${base}/watch/auth/context${qs}`)).json();
  assert.equal(ctx.feature.status, "in-progress");
  assert.equal(ctx.run_steps[0].steps[0].observed, "listening on 3000");
  assert.equal(ctx.verifications[0].verdict, "PASS");
  assert.deepEqual(ctx.shots, [{ rel: ".brain/shots/01-login.png", caption: "" }]);
  assert.ok(ctx.checks.length > 0);

  const missing = await fetch(`${base}/watch/ghost/context${qs}`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "NOT_FOUND");
  assert.equal((await fetch(`${base}/watch/auth/context?brain=relative`)).status, 404);

  // Only recorded shots are served; brain.db itself is not.
  const shot = await fetch(`${base}/watch/auth/shot/.brain/shots/01-login.png${qs}`);
  assert.equal(shot.status, 200);
  assert.equal(shot.headers.get("content-type"), "image/png");
  assert.equal((await fetch(`${base}/watch/auth/shot/.brain/brain.db${qs}`)).status, 404);
  assert.equal((await fetch(`${base}/watch/auth/shot/..%2F..%2Fetc%2Fpasswd${qs}`)).status, 404);

  // Pins: add, show in context, send, delete; cross-origin refused.
  assert.equal((await post(`/watch/auth/annotate${qs}`, { shot: ".brain/shots/01-login.png", x: 1, y: 2, note: "n" }, { origin: "http://evil.example" })).status, 403);
  assert.equal((await post(`/watch/auth/annotate${qs}`, { shot: ".brain/brain.db", x: 1, y: 2, note: "n" })).status, 400);
  const added = await (await post(`/watch/auth/annotate${qs}`, { shot: ".brain/shots/01-login.png", x: 12.34, y: 50, note: "button is clipped" })).json();
  assert.equal(added.ok, true);
  assert.equal(added.annotation.x, 12.3);
  let pins = (await (await fetch(`${base}/watch/auth/context${qs}`)).json()).annotations;
  assert.deepEqual(pins.map((a) => [a.note, a.superseded, a.sentAt]), [["button is clipped", false, null]]);
  assert.deepEqual(await (await post(`/watch/auth/annotate/send${qs}`, {})).json(), { ok: true, sent: 1 });
  assert.equal((await post(`/watch/auth/annotate/delete${qs}`, { id: "nope" })).status, 400);
  assert.equal((await post(`/watch/auth/annotate/delete${qs}`, { id: added.annotation.id })).status, 200);
  pins = (await (await fetch(`${base}/watch/auth/context${qs}`)).json()).annotations;
  assert.deepEqual(pins, []);
  assert.ok(!fs.readdirSync(brainDir).some((f) => /\.json$/.test(f)), "pins never land in .brain/");

  // SSE: a CLI write to brain.db reaches an open dashboard as context-update.
  const events = [];
  const req = http.get(`${base}/watch-events/auth${qs}`, (res) => res.on("data", (c) => events.push(String(c))));
  t.after(() => req.destroy());
  await new Promise((r) => setTimeout(r, 500));
  const before = events.join("").split("event: context-update").length;
  ok(brain(["runs", "append", "auth", "--run", "r1", "--step", "second", "--observed", "ok"]));
  const deadline = Date.now() + 5000;
  while (events.join("").split("event: context-update").length <= before && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  assert.ok(events.join("").split("event: context-update").length > before, `no context-update after a CLI write: ${events.join("")}`);
  assert.ok(fs.existsSync(path.join(dir, ".review-state", "sessions.json")));
  // The server's long-lived connection reports no false failures after the
  // CLI's writes (FTS5 structure cache).
  const checks = (await (await fetch(`${base}/watch/auth/context${qs}`)).json()).checks;
  assert.deepEqual(checks.filter((c) => c.status !== "pass"), []);
});
