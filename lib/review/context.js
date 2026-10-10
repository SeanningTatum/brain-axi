// lib/review/context.js — the JSON payloads the review chrome and the watch
// dashboard render, built from brain.db through lib/brain (read-only). The
// shapes are the ones the static assets (chrome.js, dashboard.js, lightbox.js)
// already consume; nothing here writes the brain.
//
// Every builder takes an open db handle first (lib/brain's contract) plus the
// checkout `root` that plan paths are relative to; shot paths are relative to
// `mainRoot`, the main checkout whose .brain/shots/ every worktree shares
// (defaults to root).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as L from "../brain/index.js";

// One run step's observed output is capped so a huge log cannot bloat the
// dashboard payload; the tail points at the CLI command that prints it whole.
export const STEP_OBSERVED_CAP = 8000;

const day = (iso) => (iso ? String(iso).slice(0, 10) : "");

function tryLookup(db, slug) {
  try {
    return L.features.lookup(db, slug);
  } catch (e) {
    if (L.isBrainError(e) && e.code === "NOT_FOUND") return null;
    throw e;
  }
}

// [{ rel, caption, verification }] — every shot recorded on a feature's
// verifications (or the whole brain when `slug` is null), oldest round first.
// `rel` is the stored path, relative to the main checkout (mainRoot).
export function shotsFor(db, slug = null) {
  const rows = db
    .prepare(
      `SELECT s.path, s.caption, v.round, f.slug FROM shots s
       JOIN verifications v ON v.id = s.verification_id JOIN features f ON f.id = v.feature_id
       ${slug ? "WHERE f.slug = ?" : ""} ORDER BY v.round, s.id`
    )
    .all(...(slug ? [slug] : []));
  return rows.map((r) => ({ rel: r.path, caption: r.caption || "", feature: r.slug, verification: r.round }));
}

// One entry per path — the newest round's (its caption) — for carousels:
// the browser serves a path's CURRENT file, so a path recorded in several
// rounds is one image, not several versions.
export function latestPerPath(shots) {
  const byRel = new Map();
  for (const s of shots) {
    byRel.delete(s.rel);
    byRel.set(s.rel, s);
  }
  return [...byRel.values()];
}

// True when `rel` is a recorded shot path (for `slug`, or anywhere in the brain).
export function isRecordedShot(db, rel, slug = null) {
  return shotsFor(db, slug).some((s) => s.rel === rel);
}

export function sha256OfFile(abs) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
  } catch {
    return null;
  }
}

// An annotation is superseded once its shot file is gone or no longer has the
// hash it had when the pin was dropped. `mainRoot` resolves the shot path.
export function withSuperseded(annotations, mainRoot) {
  return (annotations || []).map((a) => {
    const now = sha256OfFile(path.resolve(mainRoot, a.shot || ""));
    return { ...a, superseded: !now || (a.shotSha256 ? now !== a.shotSha256 : false), sentAt: a.sentAt ?? null };
  });
}

// The chrome sidebar's "Execution" section and the dashboard's base payload.
export function executionContext(db, root, slug, { annotations = [], mainRoot = root } = {}) {
  const f = tryLookup(db, slug);
  const checkpoints = L.progress.list(db, { limit: 5 }).map((c) => ({ date: day(c.at), summary: c.summary }));
  if (!f)
    return {
      feature: { slug, status: "unknown", evidence: "" },
      checkpoints,
      runs: [],
      verifications: [],
      shots: [],
      annotations: [],
    };
  return {
    feature: { slug: f.slug, status: f.status, evidence: f.evidence || "" },
    checkpoints,
    runs: L.runs.view(db, f.slug).runs.map((r) => ({ name: r.run, title: r.run })),
    // Newest first. `date` keeps a round suffix so same-day rounds stay distinct.
    verifications: L.verifications.list(db, { feature: f.slug }).map((v) => ({
      date: `${day(v.at)} r${v.round}`,
      verdict: v.verdict,
      round: v.round,
      commit: v.commit,
      dirty: v.dirty,
    })),
    shots: latestPerPath(shotsFor(db, f.slug)).map((s) => ({ rel: s.rel, caption: s.caption })),
    annotations: withSuperseded(annotations, mainRoot).map((a) => ({
      id: a.id,
      shot: a.shot,
      x: a.x,
      y: a.y,
      note: a.note,
      at: a.at || null,
      superseded: a.superseded,
      sentAt: a.sentAt,
    })),
  };
}

// Run steps grouped by run, oldest run first — the dashboard's log section.
export function runSteps(db, slug) {
  return L.runs.steps(db, slug).map((r) => {
    const ref = `brain runs view ${slug} --run ${r.run}`;
    return {
      name: r.run,
      title: r.run,
      file: ref,
      steps: r.steps.map((s) => {
        const long = s.observed.length > STEP_OBSERVED_CAP;
        return {
          n: s.n,
          title: s.step,
          observed: long ? s.observed.slice(0, STEP_OBSERVED_CAP) + `\n… (truncated — see ${ref})` : s.observed,
          truncated: long,
          task: s.task || null,
          author: s.author || null,
          at: s.at,
        };
      }),
    };
  });
}

// The health strip: lib/brain's check rows ({ check, status, detail }).
export function healthChecks(db, root, mainRoot = root) {
  return L.check(db, { root, mainRoot });
}

// Everything /watch/<feature> renders, in one payload.
export function watchContext(db, root, slug, { annotations = [], mainRoot = root } = {}) {
  const ctx = executionContext(db, root, slug, { annotations, mainRoot });
  const f = L.features.lookup(db, slug);
  ctx.run_steps = runSteps(db, f.slug);
  ctx.pr = f.pr_url ? { url: f.pr_url, opened_at: "" } : null;
  ctx.checks = healthChecks(db, root, mainRoot);
  return ctx;
}

// The registered plan whose file is `file` (absolute), or null.
export function planForFile(db, root, file) {
  const abs = path.resolve(file);
  return L.plans.list(db).find((p) => path.resolve(root, p.file_path) === abs) || null;
}

const planSummary = (p) => ({
  slug: p.slug,
  title: p.title,
  status: p.status,
  rounds: p.rounds,
  created: p.created,
  updated: p.updated,
  feature: p.feature || null,
});

// The review chrome's sidebar payload for one plan (null slug: no plan yet).
export function planContext(db, root, slug) {
  let full = null;
  if (slug) {
    try {
      full = L.plans.get(db, slug);
    } catch (e) {
      if (!(L.isBrainError(e) && e.code === "NOT_FOUND")) throw e;
    }
  }
  const st = L.features.stats(db);
  const last = L.progress.latest(db);
  const feature = full && full.feature;
  return {
    plan: full ? planSummary(full) : null,
    plans: L.plans.list(db).slice(0, 10).map(planSummary),
    // Newest five rounds first: { at, round, prompts, ended_by }.
    reviews: full ? full.reviews.slice(-5).reverse().map((r) => ({ at: r.at, round: r.round, prompts: r.prompts, ended_by: r.ended_by })) : [],
    screenshots: feature ? latestPerPath(shotsFor(db, feature)).slice(0, 30) : [],
    verifications: feature
      ? L.verifications.list(db, { feature }).slice(0, 10).map((v) => ({ feature, date: `${day(v.at)} r${v.round}`, verdict: v.verdict }))
      : [],
    features: {
      total: st.total,
      counts: Object.fromEntries(Object.entries(st.by_status).filter(([, n]) => n)),
      in_progress: st.in_progress ? [st.in_progress] : [],
    },
    last_checkpoint: last ? { date: day(last.at), summary: last.summary } : null,
  };
}
