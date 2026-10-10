// lib/brain/tasks.js — the coordination layer below a feature: list, get
// (the brief), add, claim, set. Closing the last open task autoships.

import crypto from "node:crypto";
import { BrainError, isBrainError } from "./errors.js";
import * as features from "./features.js";
import { now, plain, tx } from "./util.js";

export const STATUSES = ["open", "claimed", "done", "blocked", "cut"];

const SELECT = `SELECT t.id, f.slug AS feature, t.key, t.title, t.status, t.acceptance, t.verify, t.files,
  t.claimed_by, t.claimed_at, t.evidence, t.created, t.updated
  FROM tasks t JOIN features f ON f.id = t.feature_id`;

function shape(db, row) {
  const t = plain(row);
  t.files = t.files ? JSON.parse(t.files) : [];
  t.depends_on = db
    .prepare("SELECT d.key, d.status FROM task_deps x JOIN tasks d ON d.id = x.depends_on WHERE x.task_id = ? ORDER BY d.id")
    .all(t.id)
    .map(plain);
  t.ready = t.status === "open" && t.depends_on.every((d) => d.status === "done");
  return t;
}

function lookupTask(db, slug, key) {
  const f = features.lookup(db, slug);
  const row = db.prepare(`${SELECT} WHERE t.feature_id = ? AND t.key = ?`).get(f.id, String(key));
  if (!row) {
    const keys = db.prepare("SELECT key FROM tasks WHERE feature_id = ? ORDER BY id").all(f.id).map((r) => r.key);
    throw new BrainError("NOT_FOUND", `no task ${key} in ${f.slug}`, [
      keys.length ? `tasks: ${keys.join(", ")} — brain tasks list ${f.slug}` : `brain tasks add ${f.slug} --title "..." --acceptance "..."`,
    ]);
  }
  return shape(db, row);
}

export function list(db, slug) {
  const f = features.lookup(db, slug);
  return db.prepare(`${SELECT} WHERE t.feature_id = ? ORDER BY t.id`).all(f.id).map((r) => shape(db, r));
}

// The brief: the task, its feature, its dependencies and its run steps.
export function get(db, slug, key) {
  const t = lookupTask(db, slug, key);
  const f = features.lookup(db, slug);
  t.feature_info = { slug: f.slug, name: f.name, status: f.status, description: f.description };
  t.steps = db
    .prepare("SELECT run, n, step, at FROM run_steps WHERE task_id = ? ORDER BY id")
    .all(t.id)
    .map(plain);
  return t;
}

// Add task t<N+1>. Dependencies must already exist, so the graph stays acyclic.
export function add(db, slug, { title, acceptance, verify = null, dependsOn = [], files = [] } = {}) {
  if (typeof title !== "string" || !title.trim())
    throw new BrainError("INVALID_ARG", "title is required", [`brain tasks add ${slug} --title "..." --acceptance "..."`]);
  if (typeof acceptance !== "string" || !acceptance.trim())
    throw new BrainError("INVALID_ARG", "acceptance is required — a checkable definition of done", [
      `brain tasks add ${slug} --title "${title}" --acceptance "..."`,
    ]);
  return tx(db, () => {
    const f = features.lookup(db, slug);
    if (f.status === "shipped" || f.status === "cut")
      throw new BrainError("FEATURE_CLOSED", `${f.slug} is ${f.status}; it takes no new tasks`, [
        `Reopen it first: brain features set ${f.slug} --status in-progress`,
      ]);
    const deps = dependsOn.map((k) => lookupTask(db, f.slug, k).id);
    const max = db
      .prepare("SELECT coalesce(max(CAST(substr(key, 2) AS INTEGER)), 0) AS m FROM tasks WHERE feature_id = ?")
      .get(f.id).m;
    const key = `t${max + 1}`;
    const at = now();
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO tasks (feature_id, key, title, status, acceptance, verify, files, created, updated)
         VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?)`
      )
      .run(f.id, key, title.trim(), acceptance, verify, files.length ? JSON.stringify(files) : null, at, at);
    const ins = db.prepare("INSERT INTO task_deps (task_id, depends_on) VALUES (?, ?)");
    for (const d of deps) ins.run(lastInsertRowid, d);
    return lookupTask(db, f.slug, key);
  });
}

// Claim a task for `by` (a specific `key`, or the first ready one). Returns
// { task, token }; the token (or the same `by`) is what set() accepts later.
export function claim(db, slug, { key, by } = {}) {
  if (typeof by !== "string" || !by.trim())
    throw new BrainError("INVALID_ARG", "by is required — who is claiming", [`brain tasks claim ${slug} --by <name>`]);
  return tx(db, () => {
    let t;
    if (key) t = lookupTask(db, slug, key);
    else {
      t = list(db, slug).find((x) => x.ready);
      if (!t)
        throw new BrainError("NO_READY_TASK", `no open task in ${slug} has all its dependencies done`, [
          `brain tasks list ${slug}`,
        ]);
    }
    if (t.status !== "open")
      throw new BrainError(
        "TASK_NOT_CLAIMABLE",
        `${t.key} is ${t.status}${t.claimed_by ? ` by ${t.claimed_by}` : ""}`,
        t.status === "claimed"
          ? [`Wait, or have ${t.claimed_by} release it: brain tasks set ${slug} ${t.key} --status open`]
          : [`brain tasks list ${slug}`]
      );
    const waiting = t.depends_on.filter((d) => d.status !== "done");
    if (waiting.length)
      throw new BrainError("TASK_NOT_CLAIMABLE", `${t.key} waits on ${waiting.map((d) => `${d.key} (${d.status})`).join(", ")}`, [
        `Claim a ready one: brain tasks claim ${slug} --by ${by}`,
      ]);
    const token = crypto.randomBytes(8).toString("hex");
    const at = now();
    const { changes } = db
      .prepare(
        "UPDATE tasks SET status = 'claimed', claimed_by = ?, claim_token = ?, claimed_at = ?, updated = ? WHERE id = ? AND status = 'open'"
      )
      .run(by.trim(), token, at, at, t.id);
    if (!changes) throw new BrainError("TASK_NOT_CLAIMABLE", `${t.key} was claimed by someone else`, [`brain tasks list ${slug}`]);
    return { task: lookupTask(db, slug, t.key), token };
  });
}

// Update a task. status: open (releases a claim) | done (needs evidence) |
// blocked | cut. A claimed task only moves for its holder (`by` or `token`).
// Closing the last open task autoships the feature (unless autoship:false);
// a refused ship leaves the task done and throws SHIP_REFUSED with
// detail.task (#4). Returns { task, previous, ship }.
export function set(db, slug, key, { status, evidence, by, token, title, acceptance, verify, autoship = true, root } = {}) {
  if (status !== undefined) {
    if (!STATUSES.includes(status))
      throw new BrainError("INVALID_STATUS", `invalid task status "${status}"`, [`valid: ${STATUSES.join(", ")}`]);
    if (status === "claimed")
      throw new BrainError("INVALID_STATUS", "use claim to take a task", [`brain tasks claim ${slug} --key ${key} --by <name>`]);
    if (status === "done" && (typeof evidence !== "string" || !evidence.trim()))
      throw new BrainError("EVIDENCE_REQUIRED", "evidence is required to close a task", [
        `brain tasks set ${slug} ${key} --status done --evidence "<what proves the acceptance holds>"`,
      ]);
  }
  const res = tx(db, () => {
    const t = lookupTask(db, slug, key);
    if (t.status === "claimed" && status !== undefined && status !== t.status) {
      const row = db.prepare("SELECT claimed_by, claim_token FROM tasks WHERE id = ?").get(t.id);
      if (!((token && token === row.claim_token) || (by && by.trim() === row.claimed_by)))
        throw new BrainError("CLAIM_MISMATCH", `${t.key} is claimed by ${row.claimed_by}`, [
          `Pass the claim: brain tasks set ${slug} ${t.key} --status ${status} --by ${row.claimed_by}`,
        ]);
    }
    const cols = [];
    const vals = [];
    const put = (c, v) => (cols.push(`${c} = ?`), vals.push(v));
    if (status !== undefined && status !== t.status) {
      put("status", status);
      if (t.status === "claimed") (put("claimed_by", null), put("claim_token", null), put("claimed_at", null));
    }
    if (evidence !== undefined) put("evidence", evidence);
    if (title !== undefined) put("title", title.trim());
    if (acceptance !== undefined) put("acceptance", acceptance);
    if (verify !== undefined) put("verify", verify);
    if (cols.length) {
      put("updated", now());
      db.prepare(`UPDATE tasks SET ${cols.join(", ")} WHERE id = ?`).run(...vals, t.id);
    }
    const f = features.lookup(db, slug);
    const left = db.prepare("SELECT count(*) AS n FROM tasks WHERE feature_id = ? AND status IN ('open', 'claimed', 'blocked')").get(f.id).n;
    const done = db.prepare("SELECT count(*) AS n FROM tasks WHERE feature_id = ? AND status = 'done'").get(f.id).n;
    const closing = (status === "done" || status === "cut") && status !== t.status;
    return { task: lookupTask(db, slug, key), previous: t.status, last: closing && left === 0 && done > 0 && f.status !== "shipped" };
  });
  let ship = null;
  if (res.last && autoship) {
    const ev = `autoship: last open task ${key} closed — ${evidence || "cut"}`;
    try {
      ship = features.ship(db, slug, { evidence: ev, root });
    } catch (e) {
      if (!isBrainError(e)) throw e;
      throw new BrainError(
        e.code,
        `task ${key} is marked ${res.task.status}; autoship refused — ${e.message}`,
        [`Do not re-run the task update; fix the cause, then: brain features ship ${slug} --evidence "..."`, ...e.help],
        { ...(e.detail || {}), task: res.task }
      );
    }
  }
  return { task: res.task, previous: res.previous, ship };
}
