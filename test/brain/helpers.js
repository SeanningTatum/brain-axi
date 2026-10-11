// Shared test helpers: temp dirs, fresh brains, git repos. No tests here.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { create, close } from "../../lib/brain/index.js";
import { BrainError } from "../../lib/brain/errors.js";

export function tmpDir(t, prefix = "brain-test-") {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

// A git repo with one commit on branch `main`.
export function gitRepo(dir) {
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "Test Author");
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  git(dir, "add", "README.md");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

// A fresh brain in a temp dir (optionally a git repo). Returns { db, root, ... }.
export function freshBrain(t, { withGit = false } = {}) {
  const root = tmpDir(t);
  if (withGit) gitRepo(root);
  const b = create(root, { gitignore: withGit });
  t.after(() => close(b.db));
  return b;
}

// assert.throws for a BrainError with `code`; returns the error.
export function throwsCode(fn, code, msgRe) {
  let err;
  assert.throws(fn, (e) => {
    err = e;
    assert.ok(e instanceof BrainError, `expected BrainError ${code}, got ${e && e.stack}`);
    assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
    if (msgRe) assert.match(e.message, msgRe);
    assert.ok(Array.isArray(e.help) && e.help.length > 0, "BrainError must carry help lines");
    return true;
  });
  return err;
}

// A raw SQLite constraint failure (the schema itself enforcing a rule).
export function rejectsRaw(db, sql, ...args) {
  assert.throws(() => db.prepare(sql).run(...args), /constraint failed/i);
}
