// lib/brain/runs.js — run notes: verbatim, numbered steps per feature run.

import { BrainError } from "./errors.js";
import { lookup } from "./features.js";
import { NAME_RE, now, plain, today, tx } from "./util.js";

const defaultRun = () => `${today()}-progress`;

// Without `run`: { feature, runs: [{ run, steps, first_at, last_at }] }.
// With `run`: { feature, run, steps: [{ n, step, observed, task, author, at }] }.
export function view(db, slug, { run } = {}) {
  const f = lookup(db, slug);
  if (!run) {
    const runs = db
      .prepare(
        `SELECT run, count(*) AS steps, min(at) AS first_at, max(at) AS last_at
         FROM run_steps WHERE feature_id = ? GROUP BY run ORDER BY min(id)`
      )
      .all(f.id)
      .map(plain);
    return { feature: f.slug, runs };
  }
  const steps = stepsOf(db, f.id, run);
  if (!steps.length) {
    const names = db.prepare("SELECT DISTINCT run FROM run_steps WHERE feature_id = ? ORDER BY run").all(f.id).map((r) => r.run);
    throw new BrainError("NOT_FOUND", `no run "${run}" for ${f.slug}`, [
      names.length ? `runs: ${names.join(", ")}` : `brain runs append ${f.slug} --step "..." --observed "..."`,
    ]);
  }
  return { feature: f.slug, run, steps };
}

function stepsOf(db, fid, run) {
  return db
    .prepare(
      `SELECT s.n, s.step, s.observed, t.key AS task, s.author, s.at
       FROM run_steps s LEFT JOIN tasks t ON t.id = s.task_id
       WHERE s.feature_id = ? AND s.run = ? ORDER BY s.n`
    )
    .all(fid, run)
    .map(plain);
}

// Every run with its steps, oldest first — the watch dashboard's payload.
export function steps(db, slug) {
  const f = lookup(db, slug);
  return view(db, f.slug).runs.map((r) => ({ ...r, steps: stepsOf(db, f.id, r.run) }));
}

// Append step N+1 to a run (default "<today>-progress"). `observed` is stored
// verbatim. Returns { feature, run, n, at }.
export function append(db, slug, { run, step, observed, task, author = null } = {}) {
  run = run || defaultRun();
  if (!NAME_RE.test(run))
    throw new BrainError("INVALID_NAME", `invalid run name "${run}" — letters, digits, ".", "_" and "-"`, [
      `brain runs append ${slug} --run ${defaultRun()} --step "..." --observed "..."`,
    ]);
  if (typeof step !== "string" || !step.trim())
    throw new BrainError("INVALID_ARG", "step is required — what was done", [`brain runs append ${slug} --step "..." --observed "..."`]);
  if (typeof observed !== "string" || !observed.trim())
    throw new BrainError("INVALID_ARG", "observed is required — the verbatim output", [
      `brain runs append ${slug} --step "${step}" --observed "<verbatim output>"`,
    ]);
  return tx(db, () => {
    const f = lookup(db, slug);
    let taskId = null;
    if (task) {
      const t = db.prepare("SELECT id FROM tasks WHERE feature_id = ? AND key = ?").get(f.id, task);
      if (!t) throw new BrainError("NOT_FOUND", `no task ${task} in ${f.slug}`, [`brain tasks list ${f.slug}`]);
      taskId = t.id;
    }
    const n = db.prepare("SELECT coalesce(max(n), 0) + 1 AS n FROM run_steps WHERE feature_id = ? AND run = ?").get(f.id, run).n;
    const at = now();
    db.prepare("INSERT INTO run_steps (feature_id, run, n, step, observed, task_id, author, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      f.id, run, n, step.trim(), observed, taskId, author, at
    );
    return { feature: f.slug, run, n, at };
  });
}
