import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { features, verifications } from "../../lib/brain/index.js";
import { freshBrain, git, throwsCode, rejectsRaw } from "./helpers.js";

test("add stamps the commit, author and a clean tree; rounds increment", (t) => {
  const { db, root } = freshBrain(t, { withGit: true });
  git(root, "add", ".gitignore");
  git(root, "commit", "-q", "-m", "ignore brain");
  features.add(db, { slug: "f", name: "F" });
  const head = git(root, "rev-parse", "--short", "HEAD");
  const v1 = verifications.add(db, "f", { verdict: "FAIL", body: "broke on empty input", verifiedBy: "verifier-1", root });
  assert.equal(v1.round, 1);
  assert.equal(v1.commit, head);
  assert.equal(v1.dirty, false);
  assert.equal(v1.implemented_by, "Test Author");
  assert.equal(v1.verified_by, "verifier-1");
  const v2 = verifications.add(db, "f", { verdict: "PASS", body: "fixed", root });
  assert.equal(v2.round, 2);
  assert.deepEqual(verifications.latestVerdict(db, "f"), { verdict: "PASS", round: 2, commit: head, dirty: false, at: v2.at });
  assert.equal(verifications.get(db, "f").round, 2);
  assert.equal(verifications.get(db, "f", 1).verdict, "FAIL");
  assert.deepEqual(verifications.list(db, { feature: "f" }).map((v) => v.round).sort(), [1, 2]);
  throwsCode(() => verifications.get(db, "f", 7), "NOT_FOUND");
});

test("a dirty tree is recorded as dirty:true (#11)", (t) => {
  const { db, root } = freshBrain(t, { withGit: true });
  features.add(db, { slug: "f", name: "F" });
  fs.writeFileSync(path.join(root, "README.md"), "changed\n");
  assert.equal(verifications.add(db, "f", { verdict: "PASS", body: "ok", root }).dirty, true);
});

test("outside git: no commit, not dirty", (t) => {
  const { db, root } = freshBrain(t);
  features.add(db, { slug: "f", name: "F" });
  const v = verifications.add(db, "f", { verdict: "BLOCKED", body: "no env", root });
  assert.equal(v.commit, null);
  assert.equal(v.dirty, false);
  assert.equal(verifications.latestVerdict(db, "f").verdict, "BLOCKED");
});

test("shots are stored as path + sha256; missing or outside .brain/shots/ is refused", (t) => {
  const { db, root } = freshBrain(t);
  features.add(db, { slug: "f", name: "F" });
  fs.mkdirSync(path.join(root, ".brain", "shots", "f"), { recursive: true });
  fs.writeFileSync(path.join(root, ".brain", "shots", "f", "a.png"), "A");
  fs.writeFileSync(path.join(root, "loose.png"), "L");
  const v = verifications.add(db, "f", {
    verdict: "PASS", body: "ok", root,
    shots: [{ path: path.join(root, ".brain", "shots", "f", "a.png"), caption: "home" }],
  });
  assert.equal(v.shots.length, 1);
  assert.equal(v.shots[0].path, ".brain/shots/f/a.png", "stored relative to root");
  assert.equal(v.shots[0].caption, "home");
  assert.match(v.shots[0].sha256, /^[0-9a-f]{64}$/);
  throwsCode(() => verifications.add(db, "f", { verdict: "PASS", body: "ok", shots: [".brain/shots/f/none.png"], root }), "SHOT_MISSING");
  throwsCode(() => verifications.add(db, "f", { verdict: "PASS", body: "ok", shots: ["loose.png"], root }), "SHOT_OUTSIDE_SHOTS_DIR");
  assert.equal(verifications.list(db).length, 1, "nothing written on refusal");
});

test("errors: bad verdict, empty body, unknown feature; schema CHECKs", (t) => {
  const { db, root } = freshBrain(t);
  features.add(db, { slug: "f", name: "F" });
  throwsCode(() => verifications.add(db, "f", { verdict: "pass", body: "x", root }), "INVALID_VERDICT");
  throwsCode(() => verifications.add(db, "f", { verdict: "PASS", body: "", root }), "INVALID_ARG");
  throwsCode(() => verifications.add(db, "ghost", { verdict: "PASS", body: "x", root }), "NOT_FOUND");
  rejectsRaw(db, "INSERT INTO verifications (feature_id, verdict, round, body, verified_by, at) VALUES (1, 'OK', 1, 'b', 'v', 'x')");
  rejectsRaw(db, "INSERT INTO verifications (feature_id, verdict, round, body, commit_sha, verified_by, at) VALUES (1, 'PASS', 1, 'b', 'HEAD', 'v', 'x')");
  rejectsRaw(db, "INSERT INTO verifications (feature_id, verdict, round, body, verified_by, at) VALUES (99, 'PASS', 1, 'b', 'v', 'x')");
});
