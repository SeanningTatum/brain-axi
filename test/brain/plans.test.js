import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { features, plans, check } from "../../lib/brain/index.js";
import { freshBrain, throwsCode, rejectsRaw } from "./helpers.js";

function planFile(root, name = "plan.html", html = "<html><title>  My   plan </title>body</html>") {
  fs.mkdirSync(path.join(root, "plans"), { recursive: true });
  fs.writeFileSync(path.join(root, "plans", name), html);
  return `plans/${name}`;
}

test("upsert registers path + sha256 + <title>; re-upsert refreshes the hash", (t) => {
  const { db, root } = freshBrain(t);
  features.add(db, { slug: "f", name: "F" });
  const rel = planFile(root);
  const p = plans.upsert(db, { file: rel, feature: "f", root });
  assert.equal(p.created, true);
  assert.equal(p.slug, "plan");
  assert.equal(p.title, "My plan");
  assert.equal(p.file_path, "plans/plan.html");
  assert.equal(p.sha256, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, rel))).digest("hex"));
  assert.equal(p.status, "draft");
  assert.equal(p.feature, "f");
  fs.writeFileSync(path.join(root, rel), "<title>New</title>");
  const q = plans.upsert(db, { file: path.join(root, rel), root });
  assert.equal(q.created, false);
  assert.equal(q.title, "New");
  assert.equal(q.feature, "f", "feature binding kept");
  assert.notEqual(q.sha256, p.sha256);
  assert.deepEqual(plans.list(db).map((x) => x.slug), ["plan"]);
  assert.equal(plans.list(db, { feature: "f" }).length, 1);
  throwsCode(() => plans.upsert(db, { file: "plans/none.html", root }), "NOT_FOUND");
  throwsCode(() => plans.upsert(db, {}), "INVALID_ARG");
  throwsCode(() => plans.get(db, "ghost"), "NOT_FOUND");
});

test("sessions, rounds with prompts and snapshots, addPrompts", (t) => {
  const { db, root } = freshBrain(t);
  const rel = planFile(root);
  plans.upsert(db, { file: rel, slug: "p1", root });
  plans.startSession(db, "p1", { port: 4517 });
  assert.deepEqual(plans.openSessions(db).map((p) => [p.slug, p.session_port, p.session_open]), [["p1", 4517, true]]);

  const target = { type: "decision", question: "Q", choice: "A" };
  const r1 = plans.addRound(db, "p1", { prompts: [{ prompt: "change X", tag: "comment", selector: "#x" }, { prompt: "Q: A", tag: "decision", target }] });
  assert.deepEqual(r1, { slug: "p1", round: 1, status: "in-review" });
  plans.addPrompts(db, "p1", [{ prompt: "late note" }]);
  const snap = planFile(root, "p1-v2.html", "<title>v2</title>");
  const r2 = plans.addRound(db, "p1", { endedBy: "sean", snapshotPath: snap, root });
  assert.equal(r2.status, "reviewed");
  const g = plans.get(db, "p1");
  assert.equal(g.rounds, 2);
  assert.deepEqual(g.reviews[0].prompts.map((p) => p.prompt), ["change X", "Q: A", "late note"]);
  assert.deepEqual(g.reviews[0].prompts[1].target, target);
  assert.equal(g.reviews[1].ended_by, "sean");
  assert.equal(g.reviews[1].snapshot_path, "plans/p1-v2.html");
  throwsCode(() => plans.addPrompts(db, "p1", [{ prompt: "x" }], { round: 9 }), "NOT_FOUND");
  throwsCode(() => plans.addPrompts(db, "p1", [{ nope: 1 }]), "INVALID_ARG");
  throwsCode(() => plans.addRound(db, "p1", { snapshotPath: "missing.html", root }), "NOT_FOUND");
  rejectsRaw(db, "UPDATE review_prompts SET target = '{bad' WHERE seq = 1");
});

test("endSession closes the session; --approved-by approves headless and increments the round (#8)", (t) => {
  const { db, root } = freshBrain(t);
  plans.upsert(db, { file: planFile(root), slug: "p", root });
  plans.startSession(db, "p", { port: 1 });
  const plain = plans.endSession(db, "p");
  assert.equal(plain.session_open, false);
  assert.equal(plain.status, "draft");
  assert.equal(plain.approved_round, null);
  const ok = plans.endSession(db, "p", { approvedBy: "ci-bot" });
  assert.equal(ok.status, "approved");
  assert.equal(ok.approved_by, "ci-bot");
  assert.equal(ok.rounds, 1);
  assert.equal(ok.approved_round, 1);
  assert.equal(plans.get(db, "p").reviews[0].ended_by, "ci-bot");
  assert.deepEqual(plans.openSessions(db), []);
  throwsCode(() => plans.endSession(db, "p", { approvedBy: " " }), "INVALID_ARG");
  rejectsRaw(db, "UPDATE plans SET status = 'approved', approved_by = NULL");
});

test("check flags a plan file changed after registration", (t) => {
  const { db, root } = freshBrain(t);
  const rel = planFile(root);
  plans.upsert(db, { file: rel, root });
  assert.equal(check(db, { root }).find((r) => r.check === "plan and shot files").status, "pass");
  fs.appendFileSync(path.join(root, rel), "edit");
  assert.equal(check(db, { root }).find((r) => r.check === "plan and shot files").status, "fail");
});
