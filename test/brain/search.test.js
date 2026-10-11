import { test } from "node:test";
import assert from "node:assert/strict";
import { features, docs, progress, runs, verifications, search } from "../../lib/brain/index.js";
import { freshBrain, throwsCode } from "./helpers.js";

function seed(t) {
  const b = freshBrain(t);
  const { db, root } = b;
  features.add(db, { slug: "kanban", name: "Kanban board", description: "drag cards between swimlanes" });
  docs.set(db, "rules", "cli-commands", "# CLI commands\nstdout carries TOON payloads only");
  progress.add(db, { summary: "wired the websocket relay", next: "add reconnect backoff", root });
  runs.append(db, "kanban", { run: "r1", step: "ran tests", observed: "ok 12 tests passed in 340ms" });
  verifications.add(db, "kanban", { verdict: "PASS", body: "dragged a card to Done; persisted after reload", root });
  return b;
}

test("query finds all five kinds, ranked, with snippets", (t) => {
  const { db } = seed(t);
  const hit = (q) => search.query(db, q).map((r) => `${r.kind}:${r.ref}`);
  assert.deepEqual(hit("swimlanes"), ["feature:kanban"]);
  assert.deepEqual(hit("TOON payloads"), ["doc:rules/cli-commands"]);
  assert.deepEqual(hit("reconnect"), ["checkpoint:checkpoint:1"]);
  assert.deepEqual(hit("340ms"), ["run-step:kanban/r1#1"]);
  assert.deepEqual(hit("reload"), ["verification:kanban r1"]);
  const r = search.query(db, "payloads")[0];
  assert.equal(r.title, "CLI commands");
  assert.match(r.snippet, /\[payloads\]/);
  assert.equal(typeof r.rank, "number");
  // porter stemming + prefix on the last word
  assert.deepEqual(hit("drag card").sort(), ["feature:kanban", "verification:kanban r1"]);
  assert.ok(hit("swim").includes("feature:kanban"));
});

test("kind filter, limit, and punctuation that is never FTS syntax", (t) => {
  const { db } = seed(t);
  assert.deepEqual(search.query(db, "card", { kind: "verification" }).map((r) => r.kind), ["verification"]);
  assert.equal(search.query(db, "card", { limit: 1 }).length, 1);
  assert.deepEqual(search.query(db, 'kanban" OR (NEAR -'), [], "operators are quoted as plain words");
  assert.deepEqual(search.query(db, "kanban: (board)!").map((r) => r.ref), ["kanban"]);
  throwsCode(() => search.query(db, "!!!"), "BAD_QUERY");
  throwsCode(() => search.query(db, 'unbalanced "', { raw: true }), "BAD_QUERY");
  throwsCode(() => search.query(db, "x", { kind: "plan" }), "INVALID_ARG");
  assert.equal(search.toMatch("a-b c"), '"a" "b" "c"*');
});

test("the index follows updates and deletes (triggers)", (t) => {
  const { db } = seed(t);
  docs.set(db, "rules", "cli-commands", "# CLI commands\nnow about gopher tunnels");
  assert.equal(search.query(db, "payloads").length, 0);
  assert.equal(search.query(db, "gopher").length, 1);
  docs.remove(db, "rules", "cli-commands");
  assert.equal(search.query(db, "gopher").length, 0);
  features.set(db, "kanban", { description: "now with quokkas" });
  assert.deepEqual(search.query(db, "quokkas").map((r) => r.ref), ["kanban"]);
  assert.equal(search.query(db, "swimlanes").length, 0);
});
