// The review/watch payload builders (lib/review/context.js) against a temp
// brain.db: the shapes chrome.js, dashboard.js and lightbox.js consume.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as L from "../../lib/brain/index.js";
import {
  STEP_OBSERVED_CAP,
  executionContext,
  watchContext,
  planContext,
  runSteps,
  shotsFor,
  isRecordedShot,
  withSuperseded,
  sha256OfFile,
  planForFile,
} from "../../lib/review/context.js";
import { freshBrain, throwsCode } from "../brain/helpers.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// A brain with one in-progress feature carrying run steps, a verification
// with a shot, a checkpoint, and a plan with two review rounds.
function seeded(t) {
  const b = freshBrain(t, { withGit: true });
  const { db, root } = b;
  L.features.add(db, { slug: "auth", name: "Auth" });
  L.features.add(db, { slug: "other", name: "Other" });
  L.features.set(db, "auth", { status: "in-progress" });
  L.runs.append(db, "auth", { run: "r1", step: "boot", observed: "ok" });
  L.runs.append(db, "auth", { run: "r1", step: "huge log", observed: "x".repeat(STEP_OBSERVED_CAP + 50), author: "agent-a" });
  L.runs.append(db, "auth", { run: "r2", step: "later", observed: "done" });
  fs.mkdirSync(path.join(root, ".brain", "shots"), { recursive: true });
  fs.writeFileSync(path.join(root, ".brain", "shots", "01-login.png"), "png-bytes");
  L.verifications.add(db, "auth", { verdict: "PASS", body: "walked it", shots: [{ path: ".brain/shots/01-login.png", caption: "login" }], root });
  L.progress.add(db, { summary: "auth half done", feature: "auth", root });
  fs.mkdirSync(path.join(root, "plans"));
  fs.writeFileSync(path.join(root, "plans", "auth.html"), "<title>Auth plan</title><p>x</p>");
  L.plans.upsert(db, { file: "plans/auth.html", feature: "auth", root });
  L.plans.addRound(db, "auth", { prompts: [{ tag: "message", prompt: "first" }] });
  L.plans.addRound(db, "auth", { prompts: [{ tag: "decision", prompt: "Q: A", target: { type: "decision", question: "Q", choice: "A" } }] });
  return b;
}

test("executionContext: feature, checkpoints, runs, verifications, shots in the chrome's shape", (t) => {
  const { db, root } = seeded(t);
  const ctx = executionContext(db, root, "auth");
  assert.deepEqual(ctx.feature, { slug: "auth", status: "in-progress", evidence: "" });
  assert.equal(ctx.checkpoints.length, 1);
  assert.match(ctx.checkpoints[0].date, DAY);
  assert.equal(ctx.checkpoints[0].summary, "auth half done");
  assert.deepEqual(ctx.runs, [{ name: "r1", title: "r1" }, { name: "r2", title: "r2" }]);
  assert.equal(ctx.verifications.length, 1);
  assert.match(ctx.verifications[0].date, /^\d{4}-\d{2}-\d{2} r1$/);
  assert.equal(ctx.verifications[0].verdict, "PASS");
  assert.deepEqual(ctx.shots, [{ rel: ".brain/shots/01-login.png", caption: "login" }]);
  assert.deepEqual(ctx.annotations, []);
});

test("executionContext: an unknown feature degrades to status unknown, never throws", (t) => {
  const { db, root } = seeded(t);
  const ctx = executionContext(db, root, "ghost");
  assert.deepEqual(ctx.feature, { slug: "ghost", status: "unknown", evidence: "" });
  assert.deepEqual([ctx.runs, ctx.verifications, ctx.shots, ctx.annotations], [[], [], [], []]);
});

test("runSteps: grouped by run, oldest first; long output capped with a pointer", (t) => {
  const { db } = seeded(t);
  const notes = runSteps(db, "auth");
  assert.deepEqual(notes.map((n) => n.name), ["r1", "r2"]);
  assert.equal(notes[0].file, "brain runs view auth --run r1");
  assert.deepEqual(notes[0].steps.map((s) => [s.n, s.title, s.truncated]), [[1, "boot", false], [2, "huge log", true]]);
  assert.equal(notes[0].steps[1].author, "agent-a");
  assert.ok(notes[0].steps[1].observed.length < STEP_OBSERVED_CAP + 100);
  assert.match(notes[0].steps[1].observed, /truncated — see brain runs view auth --run r1/);
});

test("watchContext: run_steps, pr, checks; unknown feature is NOT_FOUND", (t) => {
  const { db, root } = seeded(t);
  let ctx = watchContext(db, root, "auth");
  assert.equal(ctx.run_steps.length, 2);
  assert.equal(ctx.pr, null);
  assert.ok(ctx.checks.length > 0);
  for (const c of ctx.checks) assert.deepEqual(Object.keys(c).sort(), ["check", "detail", "status"]);
  assert.ok(ctx.checks.every((c) => c.status === "pass"), JSON.stringify(ctx.checks));
  L.features.set(db, "auth", { pr: "https://github.com/o/r/pull/1" });
  ctx = watchContext(db, root, "auth");
  assert.deepEqual(ctx.pr, { url: "https://github.com/o/r/pull/1", opened_at: "" });
  throwsCode(() => watchContext(db, root, "ghost"), "NOT_FOUND");
});

test("watchContext: a moved shot file fails the health check row", (t) => {
  const { db, root } = seeded(t);
  fs.rmSync(path.join(root, ".brain", "shots", "01-login.png"));
  const row = watchContext(db, root, "auth").checks.find((c) => c.check === "plan and shot files");
  assert.equal(row.status, "fail");
  assert.match(row.detail, /01-login\.png is missing/);
});

test("planContext: plan, newest rounds first, feature counts, last checkpoint", (t) => {
  const { db, root } = seeded(t);
  const ctx = planContext(db, root, "auth");
  assert.equal(ctx.plan.slug, "auth");
  assert.equal(ctx.plan.title, "Auth plan");
  assert.equal(ctx.plan.status, "in-review");
  assert.equal(ctx.plan.rounds, 2);
  assert.equal(ctx.plan.feature, "auth");
  assert.deepEqual(ctx.reviews.map((r) => r.round), [2, 1]);
  assert.equal(ctx.reviews[0].prompts[0].tag, "decision");
  assert.deepEqual(ctx.reviews[0].prompts[0].target, { type: "decision", question: "Q", choice: "A" });
  assert.deepEqual(ctx.features, { total: 2, counts: { planned: 1, "in-progress": 1 }, in_progress: ["auth"] });
  assert.equal(ctx.last_checkpoint.summary, "auth half done");
  assert.equal(ctx.screenshots.length, 1);
  assert.equal(ctx.verifications[0].verdict, "PASS");
  assert.equal(ctx.plans.length, 1);
});

test("planContext: no plan (null or unknown slug) still renders the brain strip", (t) => {
  const { db, root } = seeded(t);
  for (const slug of [null, "nope"]) {
    const ctx = planContext(db, root, slug);
    assert.equal(ctx.plan, null);
    assert.deepEqual(ctx.reviews, []);
    assert.equal(ctx.features.total, 2);
  }
});

test("planForFile finds a plan by its file; shots are matched only when recorded", (t) => {
  const { db, root } = seeded(t);
  assert.equal(planForFile(db, root, path.join(root, "plans", "auth.html")).slug, "auth");
  assert.equal(planForFile(db, root, path.join(root, "plans", "other.html")), null);
  assert.equal(shotsFor(db).length, 1);
  assert.ok(isRecordedShot(db, ".brain/shots/01-login.png"));
  assert.ok(isRecordedShot(db, ".brain/shots/01-login.png", "auth"));
  assert.ok(!isRecordedShot(db, ".brain/shots/01-login.png", "other"));
  assert.ok(!isRecordedShot(db, ".brain/brain.db"));
});

test("withSuperseded: a pin goes superseded when its shot changes or disappears", (t) => {
  const { root } = seeded(t);
  const rel = ".brain/shots/01-login.png";
  const abs = path.join(root, rel);
  const pin = { id: "p1", shot: rel, x: 10, y: 20, note: "n", shotSha256: sha256OfFile(abs) };
  assert.deepEqual(withSuperseded([pin], root).map((a) => [a.superseded, a.sentAt]), [[false, null]]);
  fs.writeFileSync(abs, "new-bytes");
  assert.equal(withSuperseded([pin], root)[0].superseded, true);
  fs.rmSync(abs);
  assert.equal(withSuperseded([pin], root)[0].superseded, true);
});
