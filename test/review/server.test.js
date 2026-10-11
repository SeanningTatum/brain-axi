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
import { readPins } from "../../lib/review/server.js";

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
  return { dir, port, base, brain, ok, post, state, env, brainDir: path.join(dir, ".brain") };
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

test("review: a user End with nothing queued records one closing round; repeat polls add none", async (t) => {
  const { base, brain, ok, post } = await setup(t);
  const open = ok(brain(["review", "open", "plans/auth.html", "--no-open"]));
  const key = urlOf(open.out).split("/").pop();
  assert.equal((await post("/api/end", { key, by: "user" }, { origin: base })).status, 200);
  const poll = ok(brain(["review", "poll", "plans/auth.html", "--timeout-ms", "3000"]), /^status: ended$/m);
  assert.match(poll.out, /^ended_by: user$/m);
  let view = ok(brain(["plans", "view", "auth"]), /^status: reviewed$/m);
  assert.match(view.out, /^rounds\[1\]/m);
  assert.match(view.out, /^ {2}1,\S+,user,0$/m);
  ok(brain(["review", "poll", "plans/auth.html", "--timeout-ms", "3000"]), /^status: ended$/m);
  view = ok(brain(["plans", "view", "auth"]), /^rounds\[1\]/m);
  assert.doesNotMatch(ok(brain([])).out, /review-sessions/);
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

  // A review tab on the same brain shows the pins too: a pin write nudges it.
  const rkey = urlOf(ok(brain(["review", "open", "plans/auth.html", "--feature", "auth", "--no-open"])).out).split("/").pop();
  const revEvents = [];
  const rreq = http.get(`${base}/events/${rkey}`, (res) => res.on("data", (c) => revEvents.push(String(c))));
  t.after(() => rreq.destroy());
  await new Promise((r) => setTimeout(r, 500));
  const rbefore = revEvents.join("").split("event: context-update").length;
  assert.equal((await post(`/watch/auth/annotate${qs}`, { shot: ".brain/shots/01-login.png", x: 5, y: 5, note: "again" })).status, 200);
  const rdeadline = Date.now() + 3000;
  while (revEvents.join("").split("event: context-update").length <= rbefore && Date.now() < rdeadline) await new Promise((r) => setTimeout(r, 50));
  assert.ok(revEvents.join("").split("event: context-update").length > rbefore, "no context-update on the review tab after a pin write");
});

test("pins reach the agent: only sent pins show on verifications view; context counts sent open ones", async (t) => {
  const { base, brain, ok, post, brainDir, state } = await setup(t);
  fs.mkdirSync(path.join(brainDir, "shots"), { recursive: true });
  fs.writeFileSync(path.join(brainDir, "shots", "01-login.png"), "png-a");
  fs.writeFileSync(path.join(brainDir, "shots", "02-home.png"), "png-b");
  ok(brain(["verifications", "add", "auth", "--verdict", "PASS", "--body", "walked", "--shot", ".brain/shots/01-login.png", "--shot", ".brain/shots/02-home.png"]));
  const url = urlOf(ok(brain(["watch", "auth", "--no-open"])).out);
  const qs = url.slice(url.indexOf("?"));
  const pin = (shot, note, x = 10, y = 20) => post(`/watch/auth/annotate${qs}`, { shot, x, y, note });
  // Unsent pins are drafts: no table, no context line, just a count.
  assert.equal((await pin(".brain/shots/01-login.png", "draft only")).status, 200);
  let v = ok(brain(["verifications", "view", "auth"]));
  assert.doesNotMatch(v.out, /^pins\[/m);
  assert.match(v.out, /^draft_pins: "1 unsent/m);
  assert.doesNotMatch(ok(brain(["context"])).out, /^pins:/m);
  // Send → the agent sees it; a second sent pin whose shot is later replaced
  // reads as superseded and is not counted.
  assert.equal((await pin(".brain/shots/02-home.png", "logo, too big", 55.55, null)).status, 200);
  assert.deepEqual(await (await post(`/watch/auth/annotate/send${qs}`, {})).json(), { ok: true, sent: 2 });
  assert.equal((await pin(".brain/shots/01-login.png", "a later draft")).status, 200);
  fs.writeFileSync(path.join(brainDir, "shots", "02-home.png"), "png-b-recaptured");
  v = ok(brain(["verifications", "view", "auth"]));
  assert.match(v.out, /^pins\[2\]\{shot,pin,note,created,sent,state\}:$/m);
  assert.match(v.out, /^ {2}\.brain\/shots\/01-login\.png,"10%,20%",draft only,"[^"]+","[^"]+",open$/m);
  assert.match(v.out, /^ {2}\.brain\/shots\/02-home\.png,none,"logo, too big",.*,superseded$/m);
  assert.match(v.out, /^draft_pins: "1 unsent/m);
  assert.match(v.out, /Act on the 1 sent open pin .*re-capture its shot, then re-verify: brain verifications add auth/);
  assert.doesNotMatch(v.out, /Ship it/);
  const c = ok(brain(["context"]));
  assert.match(c.out, /^pins: "1 sent screenshot pin open \(auth\) — act on them: brain verifications view auth"$/m);
  assert.ok(Buffer.byteLength(c.out) <= 600, c.out);
  // A later verification round closes the open pin (the agent acted on it).
  await new Promise((r) => setTimeout(r, 5));
  ok(brain(["verifications", "add", "auth", "--verdict", "PASS", "--body", "fixed the clipped button"]));
  v = ok(brain(["verifications", "view", "auth"]));
  assert.match(v.out, /,re-verified$/m);
  assert.match(v.out, /Ship it/);
  assert.doesNotMatch(ok(brain(["context"])).out, /^pins:/m);
  // The CLI only reads: sessions.json is byte-identical after its reads.
  const before = fs.readFileSync(path.join(state, "sessions.json"), "utf8");
  ok(brain(["verifications", "view", "auth"]));
  ok(brain(["context"]));
  assert.equal(fs.readFileSync(path.join(state, "sessions.json"), "utf8"), before);
  void base;
});

test("readPins: filters by brain and feature, tags feature, never creates the state dir, survives a corrupt store", (t) => {
  const dir = tmp(t);
  const saved = process.env.BRAIN_AXI_STATE_DIR;
  t.after(() => (saved === undefined ? delete process.env.BRAIN_AXI_STATE_DIR : (process.env.BRAIN_AXI_STATE_DIR = saved)));
  const state = path.join(dir, "state");
  process.env.BRAIN_AXI_STATE_DIR = state;
  const brainDir = path.join(dir, ".brain");
  fs.mkdirSync(path.join(brainDir, "shots"), { recursive: true });
  fs.writeFileSync(path.join(brainDir, "shots", "a.png"), "a");
  assert.deepEqual(readPins(brainDir), []);
  assert.equal(fs.existsSync(state), false, "a read never creates the state dir");
  fs.mkdirSync(state);
  const pin = (id, extra = {}) => ({ id, shot: ".brain/shots/a.png", x: 1, y: 2, note: id, at: "2026-01-01T00:00:00.000Z", shotSha256: null, sentAt: null, ...extra });
  fs.writeFileSync(path.join(state, "sessions.json"), JSON.stringify({ sessions: {}, pins: {
    [`${brainDir}::auth`]: [pin("p1", { sentAt: "2026-01-02T00:00:00.000Z" }), null, "junk"],
    [`${brainDir}::billing`]: [pin("p2", { shot: ".brain/shots/gone.png" })],
    [`${brainDir}-other::auth`]: [pin("p3")],
    [`${brainDir}::bad`]: "not a list",
  } }));
  assert.deepEqual(readPins(brainDir, "auth").map((p) => [p.id, p.feature, p.superseded, p.sentAt]), [["p1", "auth", false, "2026-01-02T00:00:00.000Z"]]);
  assert.deepEqual(readPins(brainDir).map((p) => [p.id, p.feature, p.superseded]), [["p1", "auth", false], ["p2", "billing", true]]);
  fs.writeFileSync(path.join(state, "sessions.json"), "{ truncated");
  assert.deepEqual(readPins(brainDir), []);
});

test("watch: a brain.db replaced on disk (restore) sends context-update and serves the new file", async (t) => {
  const { base, brain, ok, brainDir } = await setup(t);
  const w = ok(brain(["watch", "auth", "--no-open"]), /^watch:$/m);
  const url = urlOf(w.out);
  const qs = url.slice(url.indexOf("?"));
  assert.equal((await (await fetch(`${base}/watch/auth/context${qs}`)).json()).feature.status, "in-progress");

  const events = [];
  const req = http.get(`${base}/watch-events/auth${qs}`, (res) => res.on("data", (c) => events.push(String(c))));
  t.after(() => req.destroy());
  await new Promise((r) => setTimeout(r, 500));
  const before = events.join("").split("event: context-update").length;

  // Replace brain.db with a different brain: auth exists but is only planned.
  for (const f of fs.readdirSync(brainDir)) if (f.startsWith("brain.db")) fs.rmSync(path.join(brainDir, f));
  ok(brain(["init"]));
  ok(brain(["features", "add", "auth", "--name", "Auth"]));

  const deadline = Date.now() + 5000;
  while (events.join("").split("event: context-update").length <= before && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  assert.ok(events.join("").split("event: context-update").length > before, `no context-update after replacing brain.db: ${events.join("")}`);
  assert.equal((await (await fetch(`${base}/watch/auth/context${qs}`)).json()).feature.status, "planned");
});

test("watch: a refetch that lands while brain.db is missing (mid-restore) does not wedge the dashboard", async (t) => {
  const { base, brain, ok, brainDir } = await setup(t);
  const url = urlOf(ok(brain(["watch", "auth", "--no-open"])).out);
  const qs = url.slice(url.indexOf("?"));
  assert.equal((await (await fetch(`${base}/watch/auth/context${qs}`)).json()).feature.status, "in-progress");
  const events = [];
  const req = http.get(`${base}/watch-events/auth${qs}`, (res) => res.on("data", (c) => events.push(String(c))));
  t.after(() => req.destroy());
  await new Promise((r) => setTimeout(r, 500));
  const count = () => events.join("").split("event: context-update").length;
  const waitMore = async (than, what) => {
    const deadline = Date.now() + 5000;
    while (count() <= than && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    assert.ok(count() > than, `no context-update after ${what}: ${events.join("")}`);
  };

  // The restore removes brain.db; the page's refetch lands in the gap and fails.
  let before = count();
  for (const f of fs.readdirSync(brainDir)) if (f.startsWith("brain.db")) fs.rmSync(path.join(brainDir, f));
  await waitMore(before, "brain.db disappeared");
  assert.equal((await fetch(`${base}/watch/auth/context${qs}`)).status, 404);
  await new Promise((r) => setTimeout(r, 600)); // a few ticks with no handle

  // The restored file appears: the next tick reopens it and the page refetches.
  before = count();
  ok(brain(["init"]));
  ok(brain(["features", "add", "auth", "--name", "Auth"]));
  await waitMore(before, "the restored brain.db appeared");
  assert.equal((await (await fetch(`${base}/watch/auth/context${qs}`)).json()).feature.status, "planned");
});

test("review: a sidebar stream opened while brain.db is missing still refreshes once it is restored", async (t) => {
  const { base, brain, ok, brainDir } = await setup(t);
  const key = urlOf(ok(brain(["review", "open", "plans/auth.html", "--feature", "auth", "--no-open"])).out).split("/").pop();
  const saved = path.join(path.dirname(brainDir), "saved.db");
  ok(brain(["export", "--out", saved]));
  for (const f of fs.readdirSync(brainDir)) if (f.startsWith("brain.db")) fs.rmSync(path.join(brainDir, f));
  const events = [];
  const req = http.get(`${base}/events/${key}`, (res) => res.on("data", (c) => events.push(String(c))));
  t.after(() => req.destroy());
  await new Promise((r) => setTimeout(r, 600)); // opened (and ticked) with no brain.db
  const count = () => events.join("").split("event: context-update").length;
  const before = count();
  ok(brain(["import", saved]));
  const deadline = Date.now() + 5000;
  while (count() <= before && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  assert.ok(count() > before, `no context-update after the restore: ${events.join("")}`);
});

test("review: a poll that dies before the ack gets the same batch re-delivered; exactly one round; the ack clears it", async (t) => {
  const { base, brain, ok, post } = await setup(t);
  const open = ok(brain(["review", "open", "plans/auth.html", "--no-open"]));
  const key = urlOf(open.out).split("/").pop();
  assert.equal((await post("/api/feedback", { key, prompts: [{ tag: "message", prompt: "tighten the intro" }] }, { origin: base })).status, 200);

  // A poll that fetched the batch and died before recording/acking it.
  const lost = await (await fetch(`${base}/api/poll?key=${key}`)).json();
  // A newer batch's DOM outline must not ride out with the re-delivered one.
  assert.equal((await post("/api/feedback", { key, prompts: [{ tag: "message", prompt: "later" }], dom_snapshot: "NEWER OUTLINE" }, { origin: base })).status, 200);
  assert.equal(lost.status, "feedback");
  assert.match(lost.batch, /^[0-9a-f-]{36}$/);
  assert.equal(lost.redelivered, undefined);
  ok(brain(["plans", "view", "auth"]), /^status: draft$/m);

  // The next CLI poll gets the SAME batch, records one round, and acks it.
  const poll = ok(brain(["review", "poll", "plans/auth.html", "--timeout-ms", "5000"]), /^status: feedback$/m);
  assert.match(poll.out, /tighten the intro/);
  assert.match(poll.out, /^redelivered: true$/m);
  assert.match(poll.out, /^snapshot_chars: 0$/m);
  assert.doesNotMatch(poll.out, /later/);
  let view = ok(brain(["plans", "view", "auth"]), /^status: in-review$/m);
  assert.match(view.out, /^rounds\[1\]/m);

  // Acked: the batch queued meanwhile comes next, with its own outline.
  const later = ok(brain(["review", "poll", "plans/auth.html", "--timeout-ms", "5000"]), /later/);
  assert.match(later.out, /^snapshot_chars: 13$/m);
  assert.doesNotMatch(later.out, /^redelivered:/m);
  ok(brain(["review", "poll", "plans/auth.html", "--timeout-ms", "1200"]), /^status: timeout$/m);
  view = ok(brain(["plans", "view", "auth"]), /^rounds\[2\]/m);

  // Recorded-but-unacked (killed between record and ack): the re-delivery is
  // deduplicated by batch id, then acked. A stale/unknown ack is a no-op.
  assert.equal((await post("/api/feedback", { key, prompts: [{ tag: "message", prompt: "second pass" }] }, { origin: base })).status, 200);
  ok(brain(["review", "poll", "plans/auth.html", "--timeout-ms", "5000"]), /second pass/);
  assert.deepEqual(await (await post("/api/ack", { key, batch: lost.batch })).json(), { ok: true, acked: false });
  assert.equal((await post("/api/ack", { key })).status, 400);
  view = ok(brain(["plans", "view", "auth"]), /^rounds\[3\]/m);
  ok(brain(["check"]), /^ok: true$/m);
});

test("review: the CLI records a re-delivered batch once even when the first delivery was recorded but not acked", async (t) => {
  const { base, brain, ok, post, brainDir } = await setup(t);
  const open = ok(brain(["review", "open", "plans/auth.html", "--no-open"]));
  const key = urlOf(open.out).split("/").pop();
  assert.equal((await post("/api/feedback", { key, prompts: [{ tag: "message", prompt: "only once" }] }, { origin: base })).status, 200);
  const first = await (await fetch(`${base}/api/poll?key=${key}`)).json();
  // Simulate the CLI having recorded this exact batch before it was killed.
  const { openBrain, plans, close } = await import("../../lib/brain/index.js");
  const b = openBrain(path.dirname(brainDir));
  plans.addRound(b.db, "auth", { prompts: first.prompts.map((p) => ({ tag: p.tag, prompt: p.prompt })), batchId: first.batch });
  close(b.db);
  const poll = ok(brain(["review", "poll", "plans/auth.html", "--timeout-ms", "5000"]), /^redelivered: true$/m);
  assert.match(poll.out, /only once/);
  ok(brain(["plans", "view", "auth"]), /^rounds\[1\]/m);
  ok(brain(["review", "poll", "plans/auth.html", "--timeout-ms", "1200"]), /^status: timeout$/m);
});

test("review: a lost-ack user-end batch re-delivered after --reopen does not close the reopened session", async (t) => {
  const { base, brain, ok, post } = await setup(t);
  const key = urlOf(ok(brain(["review", "open", "plans/auth.html", "--no-open"])).out).split("/").pop();
  assert.equal((await post("/api/feedback", { key, end: true, prompts: [{ tag: "message", prompt: "last words" }] }, { origin: base })).status, 200);
  const lost = await (await fetch(`${base}/api/poll?key=${key}`)).json(); // fetched, never acked
  assert.equal(lost.session_ended, true);
  ok(brain(["review", "open", "plans/auth.html", "--no-open", "--reopen"]), /^ {2}status: open$/m);
  const poll = ok(brain(["review", "poll", "plans/auth.html", "--timeout-ms", "5000"]), /^redelivered: true$/m);
  assert.match(poll.out, /last words/);
  assert.doesNotMatch(poll.out, /^ended_by: user$/m);
  ok(brain(["plans", "view", "auth"]), /^session_open: true$/m);
});

test("review: a user End after a lost-ack delivery rides out with the re-delivered batch", async (t) => {
  const { base, brain, ok, post } = await setup(t);
  const key = urlOf(ok(brain(["review", "open", "plans/auth.html", "--no-open"])).out).split("/").pop();
  assert.equal((await post("/api/feedback", { key, prompts: [{ tag: "message", prompt: "first" }] }, { origin: base })).status, 200);
  const lost = await (await fetch(`${base}/api/poll?key=${key}`)).json(); // fetched while open, never acked
  assert.equal(lost.session_ended, undefined);
  assert.equal((await post("/api/end", { key, by: "user" }, { origin: base })).status, 200);
  const poll = ok(brain(["review", "poll", "plans/auth.html", "--timeout-ms", "5000"]), /^redelivered: true$/m);
  assert.match(poll.out, /first/);
  assert.match(poll.out, /^ended_by: user$/m);
  const view = ok(brain(["plans", "view", "auth"]), /^session_open: false$/m);
  assert.match(view.out, /^rounds\[1\]/m);
});

test("review: a lost-ack re-delivery leaves the End to the user's final batch queued behind it", async (t) => {
  const { base, brain, ok, post } = await setup(t);
  const key = urlOf(ok(brain(["review", "open", "plans/auth.html", "--no-open"])).out).split("/").pop();
  assert.equal((await post("/api/feedback", { key, prompts: [{ tag: "message", prompt: "first" }] }, { origin: base })).status, 200);
  await (await fetch(`${base}/api/poll?key=${key}`)).json(); // never acked
  assert.equal((await post("/api/feedback", { key, end: true, prompts: [{ tag: "message", prompt: "final" }] }, { origin: base })).status, 200);
  const again = ok(brain(["review", "poll", "plans/auth.html", "--timeout-ms", "5000"]), /^redelivered: true$/m);
  assert.doesNotMatch(again.out, /^ended_by:/m);
  ok(brain(["plans", "view", "auth"]), /^session_open: true$/m);
  const last = ok(brain(["review", "poll", "plans/auth.html", "--timeout-ms", "5000"]), /final/);
  assert.match(last.out, /^ended_by: user$/m);
  const view = ok(brain(["plans", "view", "auth"]), /^session_open: false$/m);
  assert.match(view.out, /^rounds\[2\]/m);
});

test("review: two servers on different ports sharing sessions.json never erase each other's queued feedback", async (t) => {
  const { base, dir, brain, ok, post } = await setup(t);
  fs.writeFileSync(path.join(dir, "plans", "billing.html"), "<!doctype html><title>Billing</title><body><p>Bill monthly.</p></body>");
  const port2 = await freePort();
  const base2 = `http://127.0.0.1:${port2}`;
  t.after(() => fetch(`${base2}/shutdown`, { method: "POST" }).catch(() => {}));
  const keyA = urlOf(ok(brain(["review", "open", "plans/auth.html", "--no-open"])).out).split("/").pop();
  const keyB = urlOf(ok(brain(["review", "open", "plans/billing.html", "--no-open", "--port", String(port2)])).out).split("/").pop();
  const N = 60;
  const sends = [];
  for (let i = 0; i < N; i++) {
    sends.push(post("/api/feedback", { key: keyA, prompts: [{ tag: "message", prompt: `a${i}` }] }, { origin: base }));
    sends.push(
      fetch(`${base2}/api/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base2 },
        body: JSON.stringify({ key: keyB, prompts: [{ tag: "message", prompt: `b${i}` }] }),
      })
    );
  }
  for (const r of await Promise.all(sends)) assert.equal(r.status, 200);
  const a = await (await fetch(`${base}/api/poll?key=${keyA}`)).json();
  const b = await (await fetch(`${base2}/api/poll?key=${keyB}`)).json();
  assert.equal(a.prompts.length, N, "server A's batch lost prompts to server B's writes");
  assert.equal(b.prompts.length, N, "server B's batch lost prompts to server A's writes");
});

test("watch: replacing a recorded shot file (no brain.db write) sends context-update", async (t) => {
  const { base, brain, ok, brainDir } = await setup(t);
  fs.mkdirSync(path.join(brainDir, "shots"), { recursive: true });
  const shot = path.join(brainDir, "shots", "01-login.png");
  fs.writeFileSync(shot, "v1");
  ok(brain(["verifications", "add", "auth", "--verdict", "PASS", "--body", "walked", "--shot", ".brain/shots/01-login.png"]));
  const url = urlOf(ok(brain(["watch", "auth", "--no-open"])).out);
  const qs = url.slice(url.indexOf("?"));
  const events = [];
  const req = http.get(`${base}/watch-events/auth${qs}`, (res) => res.on("data", (c) => events.push(String(c))));
  t.after(() => req.destroy());
  await new Promise((r) => setTimeout(r, 600));
  const count = () => events.join("").split("event: context-update").length;
  const before = count();
  fs.writeFileSync(shot, "v2 re-captured");
  const deadline = Date.now() + 4000;
  while (count() <= before && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  assert.ok(count() > before, `no context-update after a shot replace: ${events.join("")}`);
});

test("watch: editing a registered plan file (no brain.db write) sends context-update and the health strip sees it", async (t) => {
  const { base, dir, brain, ok } = await setup(t);
  ok(brain(["review", "open", "plans/auth.html", "--no-open"]));
  const url = urlOf(ok(brain(["watch", "auth", "--no-open"])).out);
  const qs = url.slice(url.indexOf("?"));
  const events = [];
  const req = http.get(`${base}/watch-events/auth${qs}`, (res) => res.on("data", (c) => events.push(String(c))));
  t.after(() => req.destroy());
  await new Promise((r) => setTimeout(r, 600));
  const count = () => events.join("").split("event: context-update").length;
  const before = count();
  fs.writeFileSync(path.join(dir, "plans", "auth.html"), "<!doctype html><title>Auth plan</title><body><p>Edited.</p></body>");
  const deadline = Date.now() + 4000;
  while (count() <= before && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  assert.ok(count() > before, `no context-update after a plan edit: ${events.join("")}`);
  const ctx = await (await fetch(`${base}/watch/auth/context${qs}`)).json();
  assert.match(JSON.stringify(ctx.checks), /plan plans\/auth\.html changed since it was recorded/);
});

test("review: reopening a file with another brain rebinds an open tab's sidebar to that brain", async (t) => {
  const { base, brain, ok } = await setup(t);
  const key = urlOf(ok(brain(["review", "open", "plans/auth.html", "--no-open"])).out).split("/").pop();
  const events = [];
  const req = http.get(`${base}/events/${key}`, (res) => res.on("data", (c) => events.push(String(c))));
  t.after(() => req.destroy());
  await new Promise((r) => setTimeout(r, 600));
  const count = () => events.join("").split("event: context-update").length;
  const waitMore = async (n, what) => {
    const deadline = Date.now() + 4000;
    while (count() <= n && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    assert.ok(count() > n, `no context-update after ${what}: ${events.join("")}`);
  };
  ok(brain(["init", "--brain", "other"]));
  let before = count();
  ok(brain(["review", "open", "plans/auth.html", "--no-open", "--brain", "other"]));
  await waitMore(before, "the reopen");
  await new Promise((r) => setTimeout(r, 600)); // let the reopen's own writes settle
  before = count();
  ok(brain(["features", "add", "later", "--name", "Later", "--brain", "other"]));
  await waitMore(before, "a write to the new brain");
});

test("review: sessions saved by a pre-0.3 server (state.json) survive the upgrade, user-end latch included", async (t) => {
  const { dir, state, brain, ok } = await setup(t);
  const file = path.join(dir, "plans", "auth.html");
  const key = (await import("node:crypto")).createHash("sha256").update(fs.realpathSync(file)).digest("hex").slice(0, 16);
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, "state.json"), JSON.stringify({ sessions: { [key]: {
    key, file, brain: path.join(dir, ".brain"), status: "ended", ended_by: "user", prompts: [], chat: [], dom_snapshot: "" } } }));
  ok(brain(["review", "open", "plans/auth.html", "--no-open"]), /^refused: /m);
  ok(brain(["review", "open", "plans/auth.html", "--no-open", "--reopen"]), /^ {2}status: open$/m);
  assert.ok(fs.existsSync(path.join(state, "sessions.json")));
});

// Raw request with a chosen Host header (fetch will not let a test spoof it).
function rawRequest(port, { method = "GET", path: p = "/health", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("server: a foreign Host (DNS rebinding) is refused on every route; /shutdown refuses a cross-origin POST", async (t) => {
  const { port, brain, ok } = await setup(t);
  ok(brain(["review", "open", "plans/auth.html", "--no-open"]));
  assert.equal((await rawRequest(port, { headers: { host: `localhost:${port}` } })).status, 200);
  assert.equal((await rawRequest(port, { headers: { host: `rebind.evil.example:${port}` } })).status, 421);
  const evil = await rawRequest(port, {
    method: "POST",
    path: "/shutdown",
    headers: { host: `rebind.evil.example:${port}`, origin: `http://rebind.evil.example:${port}` },
  });
  assert.equal(evil.status, 421);
  const cross = await rawRequest(port, { method: "POST", path: "/shutdown", headers: { host: `127.0.0.1:${port}`, origin: "http://evil.example" } });
  assert.equal(cross.status, 403);
  assert.equal((await rawRequest(port)).status, 200, "still running");
});

test("review: an agent end after a user End keeps the user latch; relative artifact assets resolve", async (t) => {
  const { base, dir, brain, ok, post } = await setup(t);
  fs.writeFileSync(path.join(dir, "plans", "diagram.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  const open = ok(brain(["review", "open", "plans/auth.html", "--no-open"]));
  const key = urlOf(open.out).split("/").pop();
  // src="diagram.svg" inside /session/<key>/artifact resolves to /session/<key>/diagram.svg
  const asset = await fetch(`${base}/session/${key}/diagram.svg`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("content-type"), "image/svg+xml");
  assert.equal((await fetch(`${base}/session/${key}/..%2F..%2FREADME.md`)).status, 404, "sandboxed to the artifact's dir");
  assert.equal((await post("/api/end", { key, by: "user" }, { origin: base })).status, 200);
  ok(brain(["review", "end", "plans/auth.html"]));
  ok(brain(["review", "open", "plans/auth.html", "--no-open"]), /^refused: /m);
});

test("watch from a worktree: the dashboard checks plan files in that worktree (root=), shots stay in main", async (t) => {
  const { dir, base, ok, env, brainDir } = await setup(t);
  const wt = path.join(path.dirname(dir), path.basename(dir) + "-wt");
  git(dir, "worktree", "add", "-q", wt, "-b", "wt-branch");
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  fs.mkdirSync(path.join(wt, "plans"), { recursive: true });
  fs.writeFileSync(path.join(wt, "plans", "wt-only.html"), "<title>WT</title><p>x</p>");
  const L = await import("../../lib/brain/index.js");
  const b = L.openBrain(wt);
  L.plans.upsert(b.db, { file: "plans/wt-only.html", root: wt });
  L.close(b.db);
  const r = spawnSync(process.execPath, [BIN, "watch", "auth", "--no-open"], { cwd: wt, env, encoding: "utf8", timeout: 20000 });
  ok({ code: r.status, out: r.stdout, err: r.stderr });
  const url = urlOf(r.stdout);
  const qs = url.slice(url.indexOf("?"));
  assert.equal(new URLSearchParams(qs).get("root"), fs.realpathSync(wt));
  assert.equal(new URLSearchParams(qs).get("brain"), brainDir);
  const files = (c) => c.checks.find((x) => x.check === "plan and shot files");
  const ctx = await (await fetch(`${base}/watch/auth/context${qs}`)).json();
  assert.equal(files(ctx).status, "pass", JSON.stringify(files(ctx)));
  // Without root= (or with a root outside this repo) it falls back to main, where the plan is missing.
  const mainCtx = await (await fetch(`${base}/watch/auth/context?brain=${encodeURIComponent(brainDir)}&root=${encodeURIComponent(os.tmpdir())}`)).json();
  assert.match(files(mainCtx).detail, /plan plans\/wt-only\.html is missing/);
  const page = await (await fetch(url)).text();
  assert.ok(page.includes(`root: "${encodeURIComponent(fs.realpathSync(wt))}"`), "dashboard carries root into its fetches");
});

test("watch: dashboards of one feature from two checkouts each get plan-file edits from their own checkout", async (t) => {
  const { dir, base, brain, ok, env } = await setup(t);
  const wt = path.join(path.dirname(dir), path.basename(dir) + "-wt2");
  git(dir, "worktree", "add", "-q", wt, "-b", "wt2-branch");
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  fs.mkdirSync(path.join(wt, "plans"), { recursive: true });
  const plan = path.join(wt, "plans", "wt-only.html");
  fs.writeFileSync(plan, "<title>WT</title><p>x</p>");
  const L = await import("../../lib/brain/index.js");
  const b = L.openBrain(wt);
  L.plans.upsert(b.db, { file: "plans/wt-only.html", root: wt });
  L.close(b.db);
  const r = spawnSync(process.execPath, [BIN, "watch", "auth", "--no-open"], { cwd: wt, env, encoding: "utf8", timeout: 20000 });
  ok({ code: r.status, out: r.stdout, err: r.stderr });
  const wtUrl = urlOf(r.stdout);
  const mainUrl = urlOf(ok(brain(["watch", "auth", "--no-open"])).out);
  const events = [];
  const reqs = [http.get(`${base}/watch-events/auth${wtUrl.slice(wtUrl.indexOf("?"))}`, (res) => res.on("data", (c) => events.push(String(c))))];
  t.after(() => reqs.forEach((q) => q.destroy()));
  await new Promise((r2) => setTimeout(r2, 400));
  // A second dashboard of the same feature, from the main checkout.
  reqs.push(http.get(`${base}/watch-events/auth${mainUrl.slice(mainUrl.indexOf("?"))}`, (res) => res.resume()));
  await new Promise((r2) => setTimeout(r2, 600));
  const count = () => events.join("").split("event: context-update").length;
  const before = count();
  fs.writeFileSync(plan, "<title>WT</title><p>edited in the worktree</p>");
  const deadline = Date.now() + 4000;
  while (count() <= before && Date.now() < deadline) await new Promise((r2) => setTimeout(r2, 50));
  assert.ok(count() > before, `the worktree dashboard got no context-update for its plan edit: ${events.join("")}`);
});

test("watch with an explicit --brain outside git: the dashboard checks plan files in the caller's checkout", async (t) => {
  const { dir, base, brain, ok } = await setup(t);
  const ext = path.join(tmp(t), "shared", ".brain");
  ok(brain(["init", "--brain", ext]));
  ok(brain(["features", "add", "auth", "--name", "Auth", "--brain", ext]));
  const L = await import("../../lib/brain/index.js");
  const b = L.openBrain(dir, { brain: ext });
  L.plans.upsert(b.db, { file: "plans/auth.html", root: dir });
  L.close(b.db);
  const url = urlOf(ok(brain(["watch", "auth", "--no-open", "--brain", ext])).out);
  const qs = url.slice(url.indexOf("?"));
  assert.equal(new URLSearchParams(qs).get("root"), dir);
  const ctx = await (await fetch(`${base}/watch/auth/context${qs}`)).json();
  const files = ctx.checks.find((x) => x.check === "plan and shot files");
  assert.equal(files.status, "pass", JSON.stringify(files));
});

test("watch: after a brain.db restore, a re-captured shot of the NEW brain still sends context-update", async (t) => {
  const { base, brain, ok, brainDir } = await setup(t);
  const shots = path.join(brainDir, "shots");
  fs.mkdirSync(shots, { recursive: true });
  fs.writeFileSync(path.join(shots, "old.png"), "old");
  fs.writeFileSync(path.join(shots, "new.png"), "new v1");
  ok(brain(["verifications", "add", "auth", "--verdict", "PASS", "--body", "old", "--shot", ".brain/shots/old.png"]));
  const url = urlOf(ok(brain(["watch", "auth", "--no-open"])).out);
  const qs = url.slice(url.indexOf("?"));
  await fetch(`${base}/watch/auth/context${qs}`);
  const events = [];
  const req = http.get(`${base}/watch-events/auth${qs}`, (res) => res.on("data", (c) => events.push(String(c))));
  t.after(() => req.destroy());
  await new Promise((r) => setTimeout(r, 600));
  const count = () => events.join("").split("event: context-update").length;
  const waitMore = async (than, what) => {
    const deadline = Date.now() + 5000;
    while (count() <= than && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    assert.ok(count() > than, `no context-update after ${what}: ${events.join("")}`);
  };

  // Restore a different brain whose only shot is new.png.
  for (const f of fs.readdirSync(brainDir)) if (f.startsWith("brain.db")) fs.rmSync(path.join(brainDir, f));
  ok(brain(["init"]));
  ok(brain(["features", "add", "auth", "--name", "Auth"]));
  ok(brain(["verifications", "add", "auth", "--verdict", "PASS", "--body", "new", "--shot", ".brain/shots/new.png"]));
  let before = count();
  await waitMore(before, "the restore");
  await fetch(`${base}/watch/auth/context${qs}`); // reopens the handle
  await new Promise((r) => setTimeout(r, 800)); // a few ticks on the new handle
  before = count();
  fs.writeFileSync(path.join(shots, "new.png"), "new v2 re-captured");
  await waitMore(before, "re-capturing the new brain's shot");
});

test("review: the server exits after the user's End with feedback; the next poll restarts it and still records the round", async (t) => {
  // Regression (Greptile r8): with every session ended and nothing connected
  // the server shuts down, and the poll used to report the session missing.
  const { base, brain, ok, post } = await setup(t);
  const open = ok(brain(["review", "open", "plans/auth.html", "--no-open"]));
  const key = urlOf(open.out).split("/").pop();
  assert.equal((await post("/api/feedback", { key, end: true, prompts: [{ tag: "message", prompt: "final note" }] }, { origin: base })).status, 200);
  await fetch(`${base}/shutdown`, { method: "POST" });
  for (let i = 0; i < 40; i++) {
    if (!(await fetch(`${base}/health`).then(() => true, () => false))) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const poll = ok(brain(["review", "poll", "plans/auth.html", "--timeout-ms", "8000"]), /^status: feedback$/m);
  assert.match(poll.out, /final note/);
  assert.match(poll.out, /^ended_by: user$/m);
  const view = ok(brain(["plans", "view", "auth"]), /^status: reviewed$/m);
  assert.match(view.out, /^ {2}1,\S+,user,1$/m);
});

test("review: a poll from another brain is refused and leaves the batch for the session's own brain", async (t) => {
  const { base, dir, brain, ok, post } = await setup(t);
  const open = ok(brain(["review", "open", "plans/auth.html", "--no-open"]));
  const key = urlOf(open.out).split("/").pop();
  assert.equal((await post("/api/feedback", { key, prompts: [{ tag: "message", prompt: "keep me" }] }, { origin: base })).status, 200);
  ok(brain(["init", "--brain", "other"]));
  const wrong = brain(["review", "poll", "plans/auth.html", "--timeout-ms", "5000", "--brain", "other"]);
  assert.equal(wrong.code, 1, wrong.out);
  assert.match(wrong.out, /^code: BRAIN_MISMATCH$/m);
  assert.match(wrong.out, new RegExp(`brain review poll plans/auth\\.html --brain ${path.join(dir, ".brain").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  ok(brain(["plans", "list", "--brain", "other"]), /^plans\[0\]/m);
  // The right brain still gets the batch, as one round.
  const poll = ok(brain(["review", "poll", "plans/auth.html", "--timeout-ms", "5000"]), /^status: feedback$/m);
  assert.match(poll.out, /keep me/);
  ok(brain(["plans", "view", "auth"]), /^rounds\[1\]/m);
});

test("review: reopening a file with another brain is refused while its feedback is unrecorded; end checks the brain too", async (t) => {
  const { base, dir, brain, ok, post, port } = await setup(t);
  const open = ok(brain(["review", "open", "plans/auth.html", "--no-open"]));
  const key = urlOf(open.out).split("/").pop();
  assert.equal((await post("/api/feedback", { key, prompts: [{ tag: "message", prompt: "mine" }] }, { origin: base })).status, 200);
  ok(brain(["init", "--brain", "other"]));
  // The CLI refuses before registering the plan in the other brain...
  const moved = brain(["review", "open", "plans/auth.html", "--no-open", "--brain", "other"]);
  assert.equal(moved.code, 1, moved.out);
  assert.match(moved.out, /^code: BRAIN_MISMATCH$/m);
  ok(brain(["plans", "list", "--brain", "other"]), /^plans\[0\]/m);
  // ...and the server refuses the re-bind on its own.
  const direct = await post("/api/open", { file: path.join(dir, "plans", "auth.html"), brain: path.join(dir, "other") }, { origin: base });
  assert.equal(direct.status, 409);
  assert.match((await direct.json()).help, /brain review poll .*auth\.html --brain /);
  // review end from the other brain changes neither side.
  const end = brain(["review", "end", "plans/auth.html", "--brain", "other"]);
  assert.equal(end.code, 1, end.out);
  assert.match(end.out, /^code: BRAIN_MISMATCH$/m);
  assert.match(end.out, /brain review end plans\/auth\.html --brain /);
  const s = await (await fetch(`${base}/api/poll?key=${key}`)).json();
  assert.equal(s.status, "feedback", "the session is still open with its batch");
  assert.ok(port);
});

test("review: two polls that both see the user's End record one closing round", async (t) => {
  const { base, brain, ok, post, env, dir } = await setup(t);
  const open = ok(brain(["review", "open", "plans/auth.html", "--no-open"]));
  const key = urlOf(open.out).split("/").pop();
  assert.equal((await post("/api/end", { key, by: "user" }, { origin: base })).status, 200);
  const { spawn } = await import("node:child_process");
  const BINP = fileURLToPath(new URL("../../bin/brain.js", import.meta.url));
  const run = () =>
    new Promise((resolve) => {
      const c = spawn(process.execPath, [BINP, "review", "poll", "plans/auth.html", "--timeout-ms", "5000"], { cwd: dir, env });
      let out = "";
      c.stdout.on("data", (d) => (out += d));
      c.on("exit", (code) => resolve({ code, out }));
    });
  const rs = await Promise.all([run(), run(), run()]);
  for (const r of rs) assert.equal(r.code, 0, r.out);
  const view = ok(brain(["plans", "view", "auth"]), /^rounds\[1\]/m);
  assert.match(view.out, /^ {2}1,\S+,user,0$/m);
});
