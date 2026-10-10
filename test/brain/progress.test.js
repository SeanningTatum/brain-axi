import { test } from "node:test";
import assert from "node:assert/strict";
import { features, progress, SUMMARY_MAX_CHARS } from "../../lib/brain/index.js";
import { freshBrain, throwsCode, rejectsRaw } from "./helpers.js";

test("add, list newest first, latest, get; branch is 'none' without git", (t) => {
  const { db, root } = freshBrain(t);
  assert.equal(progress.latest(db), null);
  progress.add(db, { summary: "first", root });
  const c = progress.add(db, { summary: "  second  ", next: "do x", body: "detail", root });
  assert.equal(c.summary, "second");
  assert.equal(c.branch, "none");
  assert.equal(c.next, "do x");
  assert.equal(c.feature, null);
  assert.deepEqual(progress.list(db).map((x) => x.summary), ["second", "first"]);
  assert.equal(progress.list(db, { limit: 1 }).length, 1);
  assert.equal(progress.latest(db).id, c.id);
  assert.equal(progress.get(db, c.id).body, "detail");
  throwsCode(() => progress.get(db, 999), "NOT_FOUND");
  throwsCode(() => progress.add(db, { summary: " " }), "INVALID_ARG");
});

test("branch comes from git in a repo", (t) => {
  const { db, root } = freshBrain(t, { withGit: true });
  assert.equal(progress.add(db, { summary: "x", root }).branch, "main");
  assert.equal(progress.add(db, { summary: "y", branch: "explicit", root }).branch, "explicit");
});

test("a summary over 200 chars throws SUMMARY_TOO_LONG, or clips with … — never a silent cut (#5)", (t) => {
  const { db, root } = freshBrain(t);
  const exact = "a".repeat(SUMMARY_MAX_CHARS);
  assert.equal(progress.add(db, { summary: exact, root }).summary, exact);
  const long = "word ".repeat(60);
  const e = throwsCode(() => progress.add(db, { summary: long, root }), "SUMMARY_TOO_LONG", /299 characters; the limit is 200/);
  assert.equal(e.exitCode, 2);
  assert.equal(progress.list(db).length, 1, "nothing written on refusal");
  const clipped = progress.add(db, { summary: long, clip: true, root }).summary;
  assert.ok(clipped.endsWith("…"));
  assert.ok(Array.from(clipped).length <= SUMMARY_MAX_CHARS);
  // emoji are one character each, never split
  const emoji = progress.add(db, { summary: "🚀".repeat(250), clip: true, root }).summary;
  assert.equal(Array.from(emoji).length, SUMMARY_MAX_CHARS);
  assert.ok(!/[\uD800-\uDBFF]…$/.test(emoji));
  rejectsRaw(db, "INSERT INTO checkpoints (at, summary) VALUES ('x', ?)", "a".repeat(201));
});

test("run links a run note (#9) and feature links a feature", (t) => {
  const { db, root } = freshBrain(t);
  features.add(db, { slug: "f", name: "F" });
  const c = progress.add(db, { summary: "step done", feature: "f", run: "2026-10-10-progress", root });
  assert.equal(c.run, "2026-10-10-progress");
  assert.equal(c.feature, "f");
  assert.equal(progress.list(db, { feature: "f" }).length, 1);
  throwsCode(() => progress.add(db, { summary: "x", run: "bad/name", root }), "INVALID_NAME");
  throwsCode(() => progress.add(db, { summary: "x", feature: "ghost", root }), "NOT_FOUND");
  rejectsRaw(db, "INSERT INTO checkpoints (at, summary, run) VALUES ('x', 'y', 'a b')");
});
