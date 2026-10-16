import { test } from "node:test";
import assert from "node:assert/strict";
import { docs, features } from "../../lib/brain/index.js";
import { freshBrain, throwsCode, rejectsRaw } from "./helpers.js";

test("set creates then replaces; title is the first heading; list and get", (t) => {
  const { db } = freshBrain(t);
  const a = docs.set(db, "rules", "cli-commands", "intro\n# CLI commands\n\nstdout is TOON");
  assert.equal(a.created, true);
  assert.equal(a.title, "CLI commands");
  const b = docs.set(db, "rules", "cli-commands", "# CLI v2\nbody");
  assert.equal(b.created, false);
  assert.equal(b.title, "CLI v2");
  docs.set(db, "recipes", "release", "no heading here");
  assert.deepEqual(docs.list(db).map((d) => `${d.section}/${d.name}`), ["recipes/release", "rules/cli-commands"]);
  assert.deepEqual(docs.list(db, { section: "rules" }).map((d) => d.bytes), [Buffer.byteLength("# CLI v2\nbody")]);
  assert.equal(docs.get(db, "recipes", "release").title, null);
  assert.equal(docs.get(db, "rules", "cli-commands").body, "# CLI v2\nbody");
});

test("every allowed section works; others are INVALID_SECTION (and the schema agrees)", (t) => {
  const { db } = freshBrain(t);
  for (const s of docs.SECTIONS) docs.set(db, s, "n", "# x");
  assert.deepEqual(docs.SECTIONS, ["rules", "recipes", "codebase", "architecture", "features", "emails", "transcripts"]);
  throwsCode(() => docs.set(db, "high-level-architecture", "n", "x"), "INVALID_SECTION");
  throwsCode(() => docs.list(db, { section: "runs" }), "INVALID_SECTION");
  rejectsRaw(db, "INSERT INTO docs (section, name, body, updated) VALUES ('notes', 'n', 'b', 'x')");
});

test("remove, NOT_FOUND, bad names and empty bodies", (t) => {
  const { db } = freshBrain(t);
  docs.set(db, "rules", "a", "# A");
  assert.deepEqual(docs.remove(db, "rules", "a"), { section: "rules", name: "a", removed: true });
  throwsCode(() => docs.remove(db, "rules", "a"), "NOT_FOUND");
  throwsCode(() => docs.get(db, "rules", "a"), "NOT_FOUND");
  throwsCode(() => docs.set(db, "rules", "a/b", "x"), "INVALID_NAME");
  throwsCode(() => docs.set(db, "rules", "a", "  "), "INVALID_ARG");
});

test("a features doc shows up on features.get", (t) => {
  const { db } = freshBrain(t);
  features.add(db, { slug: "f", name: "F" });
  docs.set(db, "features", "f", "# Feature: F\npurpose");
  assert.equal(features.get(db, "f").doc.title, "Feature: F");
});
