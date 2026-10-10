import { test } from "node:test";
import assert from "node:assert/strict";
import { features, tasks, verifications, verify, progress, check, SUMMARY_MAX_CHARS } from "../../lib/brain/index.js";
import fs from "node:fs";
import path from "node:path";
import { freshBrain, git, throwsCode, rejectsRaw } from "./helpers.js";

test("add, list, get, stats", (t) => {
  const { db } = freshBrain(t);
  features.add(db, { slug: "base", name: "Base" });
  const f = features.add(db, { slug: "todo-list", name: " Todo list ", description: "lists", dependsOn: ["base"] });
  assert.equal(f.name, "Todo list");
  assert.equal(f.status, "planned");
  assert.deepEqual(f.depends_on, ["base"]);
  assert.equal(f.grandfathered, false);
  assert.deepEqual(features.list(db).map((x) => x.slug), ["base", "todo-list"]);
  assert.deepEqual(features.list(db, { status: "planned" }).length, 2);
  const g = features.get(db, "todo-list");
  assert.deepEqual(g.tasks, []);
  assert.equal(g.verdict, null);
  assert.equal(g.doc, null);
  features.set(db, "base", { status: "in-progress" });
  assert.deepEqual(features.stats(db), {
    total: 2,
    by_status: { planned: 1, "in-progress": 1, shipped: 0, blocked: 0, cut: 0 },
    in_progress: "base",
  });
});

test("add rejects bad input with typed errors", (t) => {
  const { db } = freshBrain(t);
  for (const slug of ["Bad", "a--b", "-a", "a-", "a b", ""]) throwsCode(() => features.add(db, { slug, name: "x" }), "INVALID_SLUG");
  throwsCode(() => features.add(db, { slug: "ok", name: " " }), "INVALID_ARG");
  throwsCode(() => features.add(db, { slug: "ok", name: "x", status: "done" }), "INVALID_STATUS");
  throwsCode(() => features.add(db, { slug: "ok", name: "x", status: "shipped" }), "INVALID_STATUS");
  throwsCode(() => features.add(db, { slug: "ok", name: "x", dependsOn: ["ghost"] }), "NOT_FOUND");
  features.add(db, { slug: "ok", name: "x" });
  throwsCode(() => features.add(db, { slug: "ok", name: "x" }), "FEATURE_EXISTS");
  throwsCode(() => features.get(db, "nope"), "NOT_FOUND", /no feature "nope"/);
  assert.equal(throwsCode(() => features.add(db, { slug: "Bad", name: "x" }), "INVALID_SLUG").exitCode, 2);
});

test("one feature in-progress: the partial unique index and ONE_IN_PROGRESS naming the holder", (t) => {
  const { db } = freshBrain(t);
  features.add(db, { slug: "a", name: "A", status: "in-progress" });
  features.add(db, { slug: "b", name: "B" });
  const e = throwsCode(() => features.set(db, "b", { status: "in-progress" }), "ONE_IN_PROGRESS", /a is already in-progress/);
  assert.ok(e.help.some((h) => h.includes("brain features set a --status")));
  throwsCode(() => features.add(db, { slug: "c", name: "C", status: "in-progress" }), "ONE_IN_PROGRESS");
  rejectsRaw(db, "UPDATE features SET status = 'in-progress' WHERE slug = 'b'");
  features.set(db, "a", { status: "in-progress" }); // re-setting the holder is a no-op
  features.set(db, "a", { status: "blocked" });
  features.set(db, "b", { status: "in-progress" });
  assert.equal(features.stats(db).in_progress, "b");
});

test("set: pr, name, description; shipping via set is refused; bad pr rejected", (t) => {
  const { db } = freshBrain(t);
  features.add(db, { slug: "a", name: "A" });
  const r = features.set(db, "a", { pr: "https://github.com/o/r/pull/1", name: "A2", description: "d" });
  assert.equal(r.changed, true);
  assert.equal(r.feature.pr_url, "https://github.com/o/r/pull/1");
  assert.equal(r.feature.name, "A2");
  assert.equal(features.set(db, "a", {}).changed, false);
  throwsCode(() => features.set(db, "a", { status: "shipped" }), "USE_SHIP");
  throwsCode(() => features.set(db, "a", { pr: "not a url" }), "INVALID_ARG");
  throwsCode(() => features.set(db, "a", { status: "nope" }), "INVALID_STATUS");
  rejectsRaw(db, "UPDATE features SET pr_url = 'ftp://x' WHERE slug = 'a'");
});

test("schema: shipped needs evidence; grandfathered only when shipped", (t) => {
  const { db } = freshBrain(t);
  features.add(db, { slug: "a", name: "A" });
  rejectsRaw(db, "UPDATE features SET status = 'shipped' WHERE slug = 'a'");
  rejectsRaw(db, "UPDATE features SET grandfathered = 1 WHERE slug = 'a'");
  rejectsRaw(db, "UPDATE features SET status = 'done' WHERE slug = 'a'");
});

test("grandfathered: imported shipped history without a verification passes check", (t) => {
  const { db, root } = freshBrain(t);
  const f = features.add(db, { slug: "old", name: "Old", status: "shipped", evidence: "shipped in 0.2", grandfathered: true });
  assert.equal(f.grandfathered, true);
  assert.deepEqual(check(db, { root }).filter((r) => r.status === "fail"), []);
  throwsCode(() => features.add(db, { slug: "x", name: "X", grandfathered: true }), "INVALID_ARG");
  // reopening clears the flag
  features.set(db, "old", { status: "planned" });
  assert.equal(features.get(db, "old").grandfathered, false);
});

test("ship refuses without a PASS verification; the hint is built from verify_checks (#4)", (t) => {
  const { db, root } = freshBrain(t);
  features.add(db, { slug: "a", name: "A", status: "in-progress" });
  throwsCode(() => features.ship(db, "a", { evidence: " " }), "EVIDENCE_REQUIRED");

  let e = throwsCode(() => features.ship(db, "a", { evidence: "works", root }), "SHIP_REFUSED", /no verification recorded/);
  assert.equal(e.exitCode, 1);
  assert.ok(e.help.some((h) => /brain verify add/.test(h)), "no checks declared → says to declare real ones");
  assert.ok(!e.help.join("\n").includes("bun run"), "never a hardcoded runner");
  assert.deepEqual(e.detail.reasons, ["no verification recorded"]);

  verify.addCheck(db, { name: "unit", run: "node --test test/x", stages: ["baseline", "verify"] });
  verify.addCheck(db, { name: "lint", run: "npm run lint", stages: ["verify"] });
  verifications.add(db, "a", { verdict: "FAIL", body: "broken", root });
  e = throwsCode(() => features.ship(db, "a", { evidence: "works", root }), "SHIP_REFUSED", /round 1\) is FAIL/);
  const hint = e.help.join("\n");
  assert.match(hint, /brain verify run --stage verify/);
  assert.match(hint, /unit: node --test test\/x/);
  assert.match(hint, /lint: npm run lint/);
  assert.match(hint, /brain verifications add a --verdict PASS/);
  assert.equal(features.get(db, "a").status, "in-progress", "a refusal writes nothing");
  assert.equal(progress.latest(db), null);
});

test("ship refuses while tasks are open", (t) => {
  const { db, root } = freshBrain(t);
  features.add(db, { slug: "a", name: "A" });
  tasks.add(db, "a", { title: "x", acceptance: "y" });
  verifications.add(db, "a", { verdict: "PASS", body: "ok", root });
  const e = throwsCode(() => features.ship(db, "a", { evidence: "works", root }), "SHIP_REFUSED", /open tasks: t1/);
  assert.ok(e.help.some((h) => h.includes("brain tasks set a <task> --status done|cut")));
});

test("ship: structured outcome, checkpoint clipped with … and the full evidence kept (#5)", (t) => {
  const { db, root } = freshBrain(t);
  features.add(db, { slug: "a", name: "A", status: "in-progress" });
  verifications.add(db, "a", { verdict: "PASS", body: "ok", root });
  const evidence = "é".repeat(250);
  const out = features.ship(db, "a", { evidence, root });
  assert.equal(out.outcome, "shipped");
  assert.equal(out.previous, "in-progress");
  assert.equal(out.feature.status, "shipped");
  assert.equal(out.feature.evidence, evidence);
  assert.equal(out.checkpoint.clipped, true);
  assert.equal(Array.from(out.checkpoint.summary).length, SUMMARY_MAX_CHARS);
  assert.ok(out.checkpoint.summary.startsWith("shipped a: "));
  assert.ok(out.checkpoint.summary.endsWith("…"));
  assert.equal(out.checkpoint.body, evidence);
  assert.equal(out.checkpoint.feature, "a");
  assert.equal(features.stats(db).in_progress, null, "shipping frees the slot");

  const again = features.ship(db, "a", { evidence: "x", root });
  assert.equal(again.outcome, "already-shipped");
  assert.equal(again.checkpoint, null);

  features.add(db, { slug: "b", name: "B" });
  verifications.add(db, "b", { verdict: "PASS", body: "ok", root });
  const short = features.ship(db, "b", { evidence: "short", root });
  assert.equal(short.checkpoint.clipped, false);
  assert.equal(short.checkpoint.summary, "shipped b: short");
});

// A git brain whose .gitignore is committed, so the tree is clean.
function cleanGitBrain(t) {
  const b = freshBrain(t, { withGit: true });
  git(b.root, "add", ".gitignore");
  git(b.root, "commit", "-q", "-m", "ignore brain");
  return b;
}

test("ship warning: none when the clean PASS commit is HEAD or an ancestor of it", (t) => {
  const { db, root } = cleanGitBrain(t);
  features.add(db, { slug: "a", name: "A" });
  verifications.add(db, "a", { verdict: "PASS", body: "ok", root });
  fs.writeFileSync(path.join(root, "later.txt"), "x\n");
  git(root, "add", "later.txt");
  git(root, "commit", "-q", "-m", "later");
  const out = features.ship(db, "a", { evidence: "works", root });
  assert.equal(out.outcome, "shipped");
  assert.equal(out.warning, null);
  assert.equal(features.ship(db, "a", { evidence: "x", root }).warning, null, "already-shipped carries no warning");
});

test("ship warning: PASS commit not an ancestor of HEAD — ships anyway, warns", (t) => {
  const { db, root } = cleanGitBrain(t);
  features.add(db, { slug: "a", name: "A" });
  git(root, "checkout", "-q", "-b", "side");
  fs.writeFileSync(path.join(root, "side.txt"), "x\n");
  git(root, "add", "side.txt");
  git(root, "commit", "-q", "-m", "side");
  const v = verifications.add(db, "a", { verdict: "PASS", body: "ok", root });
  git(root, "checkout", "-q", "main");
  const head = git(root, "rev-parse", "--short", "HEAD");
  const out = features.ship(db, "a", { evidence: "works", root });
  assert.equal(out.outcome, "shipped");
  assert.equal(out.feature.status, "shipped");
  assert.equal(out.warning.commit, v.commit);
  assert.equal(out.warning.head, head);
  assert.match(out.warning.message, new RegExp(`taken on ${v.commit}, which is not an ancestor of HEAD ${head}`));
  assert.match(out.warning.help[0], /brain-verify.*brain verifications add a --verdict PASS/);
});

test("ship warning: PASS recorded on a dirty tree", (t) => {
  const { db, root } = cleanGitBrain(t);
  features.add(db, { slug: "a", name: "A" });
  fs.writeFileSync(path.join(root, "wip.txt"), "x\n");
  assert.equal(verifications.add(db, "a", { verdict: "PASS", body: "ok", root }).dirty, true);
  const out = features.ship(db, "a", { evidence: "works", root });
  assert.equal(out.outcome, "shipped");
  assert.deepEqual(out.warning.reasons, ["PASS verification (round 1) was recorded on a dirty tree (uncommitted changes)"]);
});

test("ship warning: PASS with no commit (outside git) or an unknown commit", (t) => {
  const { db, root } = freshBrain(t);
  features.add(db, { slug: "a", name: "A" });
  verifications.add(db, "a", { verdict: "PASS", body: "ok", root });
  const out = features.ship(db, "a", { evidence: "works", root });
  assert.equal(out.outcome, "shipped");
  assert.match(out.warning.message, /round 1\) recorded no commit/);
  assert.equal(out.warning.commit, null);

  const g = cleanGitBrain(t);
  features.add(g.db, { slug: "b", name: "B" });
  verifications.add(g.db, "b", { verdict: "PASS", body: "ok", root: g.root });
  g.db.prepare("UPDATE verifications SET commit_sha = 'deadbee'").run();
  const out2 = features.ship(g.db, "b", { evidence: "works", root: g.root });
  assert.equal(out2.outcome, "shipped");
  assert.match(out2.warning.message, /commit deadbee is unknown in this checkout/);
});

test("ship warning: autoship (closing the last task) returns it on the ship outcome", (t) => {
  const { db, root } = cleanGitBrain(t);
  features.add(db, { slug: "a", name: "A", status: "in-progress" });
  tasks.add(db, "a", { title: "one", acceptance: "done" });
  fs.writeFileSync(path.join(root, "wip.txt"), "x\n");
  verifications.add(db, "a", { verdict: "PASS", body: "ok", root });
  const r = tasks.set(db, "a", "t1", { status: "done", evidence: "works", by: "w1", root });
  assert.equal(r.ship.outcome, "shipped");
  assert.match(r.ship.warning.message, /dirty tree/);
});
