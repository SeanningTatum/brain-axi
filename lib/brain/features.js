// lib/brain/features.js — the feature tracker: list, get, add, set, ship, stats.

import { BrainError } from "./errors.js";
import * as progress from "./progress.js";
import { latestVerdict } from "./verifications.js";
import { shipHint } from "./verify.js";
import { SLUG_RE, SUMMARY_MAX_CHARS, clipChars, gitBranch, gitHead, gitIsAncestor, now, plain, tx } from "./util.js";

export const STATUSES = ["planned", "in-progress", "shipped", "blocked", "cut"];
const OPEN_TASK = "('open', 'claimed', 'blocked')";

function shape(db, row) {
  if (!row) return null;
  const f = plain(row);
  f.grandfathered = !!f.grandfathered;
  f.depends_on = db
    .prepare(
      `SELECT d.slug FROM feature_deps x JOIN features d ON d.id = x.depends_on
       WHERE x.feature_id = ? ORDER BY d.slug`
    )
    .all(f.id)
    .map((r) => r.slug);
  return f;
}

// Feature row by slug, or BrainError NOT_FOUND naming the known slugs.
export function lookup(db, slug) {
  const row = db.prepare("SELECT * FROM features WHERE slug = ?").get(String(slug));
  if (row) return shape(db, row);
  const known = db.prepare("SELECT slug FROM features ORDER BY slug").all().map((r) => r.slug);
  throw new BrainError("NOT_FOUND", `no feature "${slug}"`, [
    known.length ? `known slugs: ${known.join(", ")}` : "no features yet — brain features add <slug> --name \"...\"",
  ]);
}

function assertStatus(status) {
  if (!STATUSES.includes(status))
    throw new BrainError("INVALID_STATUS", `invalid status "${status}"`, [`valid statuses: ${STATUSES.join(", ")}`]);
}

// The feature holding the in-progress slot, other than `exceptId`.
function slotHolder(db, exceptId = -1) {
  return db.prepare("SELECT slug FROM features WHERE status = 'in-progress' AND id <> ?").get(exceptId);
}

function oneInProgress(holder, slug) {
  return new BrainError("ONE_IN_PROGRESS", `${holder.slug} is already in-progress (one feature at a time)`, [
    `Release the slot first: brain features set ${holder.slug} --status planned|blocked`,
    `Or ship it: brain features ship ${holder.slug} --evidence "..."`,
    ...(slug ? [`Then retry: brain features set ${slug} --status in-progress`] : []),
  ]);
}

// [{...feature, depends_on, tasks_open, tasks_total}] by id; `status` filters.
export function list(db, { status } = {}) {
  if (status !== undefined) assertStatus(status);
  const rows = db
    .prepare(
      `SELECT f.*,
         (SELECT count(*) FROM tasks t WHERE t.feature_id = f.id AND t.status IN ${OPEN_TASK}) AS tasks_open,
         (SELECT count(*) FROM tasks t WHERE t.feature_id = f.id) AS tasks_total
       FROM features f ${status ? "WHERE f.status = ?" : ""} ORDER BY f.id`
    )
    .all(...(status ? [status] : []));
  return rows.map((r) => shape(db, r));
}

// One feature with its tasks, latest verdict and feature doc (if any).
export function get(db, slug) {
  const f = lookup(db, slug);
  f.tasks = db
    .prepare("SELECT key, title, status, claimed_by FROM tasks WHERE feature_id = ? ORDER BY id")
    .all(f.id)
    .map(plain);
  f.verdict = latestVerdict(db, f.slug);
  const doc = db.prepare("SELECT title, body, updated FROM docs WHERE section = 'features' AND name = ?").get(f.slug);
  f.doc = plain(doc);
  return f;
}

// Add a feature. A new feature cannot start shipped unless it is imported
// history (`grandfathered` + evidence).
export function add(db, { slug, name, description = null, dependsOn = [], status = "planned", evidence = null, grandfathered = false, prUrl = null } = {}) {
  if (typeof slug !== "string" || !SLUG_RE.test(slug))
    throw new BrainError("INVALID_SLUG", `invalid slug "${slug}" — use lowercase letters, digits and single hyphens`, [
      `brain features add ${String(slug || "my-feature").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "my-feature"} --name "..."`,
    ]);
  if (typeof name !== "string" || !name.trim())
    throw new BrainError("INVALID_ARG", "name is required", [`brain features add ${slug} --name "..."`]);
  assertStatus(status);
  if (status === "shipped" && !grandfathered)
    throw new BrainError("INVALID_STATUS", "a new feature cannot start shipped — shipping needs evidence and a PASS verification", [
      `brain features add ${slug} --name "..."; later brain features ship ${slug} --evidence "..."`,
    ]);
  if (grandfathered && (status !== "shipped" || !evidence || !String(evidence).trim()))
    throw new BrainError("INVALID_ARG", "grandfathered is only for features imported as shipped, with evidence", [
      "Pass status shipped and evidence, or drop grandfathered",
    ]);
  return tx(db, () => {
    if (db.prepare("SELECT 1 FROM features WHERE slug = ?").get(slug))
      throw new BrainError("FEATURE_EXISTS", `feature "${slug}" already exists`, [
        `brain features view ${slug}`,
        "Or pick a different slug",
      ]);
    if (status === "in-progress") {
      const holder = slotHolder(db);
      if (holder) throw oneInProgress(holder);
    }
    const deps = dependsOn.map((d) => lookup(db, d).id);
    const at = now();
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO features (slug, name, status, description, pr_url, evidence, grandfathered, created, updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(slug, name.trim(), status, description, prUrl, evidence, grandfathered ? 1 : 0, at, at);
    const ins = db.prepare("INSERT INTO feature_deps (feature_id, depends_on) VALUES (?, ?)");
    for (const d of deps) ins.run(lastInsertRowid, d);
    return lookup(db, slug);
  });
}

// Update status, pr, name, description. Shipping goes through ship().
export function set(db, slug, { status, pr, name, description } = {}) {
  if (status !== undefined) {
    assertStatus(status);
    if (status === "shipped")
      throw new BrainError("USE_SHIP", "set cannot ship a feature — shipping needs evidence and a PASS verification", [
        `brain features ship ${slug} --evidence "..."`,
      ]);
  }
  if (pr !== undefined && pr !== null && !/^https?:\/\/\S+$/.test(pr))
    throw new BrainError("INVALID_ARG", `pr must be an http(s) URL, got "${pr}"`, [
      `brain features set ${slug} --pr https://github.com/<owner>/<repo>/pull/<n>`,
    ]);
  if (name !== undefined && (typeof name !== "string" || !name.trim()))
    throw new BrainError("INVALID_ARG", "name must be non-empty", [`brain features set ${slug} --name "..."`]);
  return tx(db, () => {
    const f = lookup(db, slug);
    if (status === "in-progress" && f.status !== "in-progress") {
      const holder = slotHolder(db, f.id);
      if (holder) throw oneInProgress(holder, slug);
    }
    const cols = [];
    const vals = [];
    const put = (c, v) => (cols.push(`${c} = ?`), vals.push(v));
    if (status !== undefined && status !== f.status) {
      put("status", status);
      if (f.status === "shipped") put("grandfathered", 0);
    }
    if (pr !== undefined) put("pr_url", pr);
    if (name !== undefined) put("name", name.trim());
    if (description !== undefined) put("description", description);
    if (cols.length) {
      put("updated", now());
      db.prepare(`UPDATE features SET ${cols.join(", ")} WHERE id = ?`).run(...vals, f.id);
    }
    return { feature: lookup(db, slug), previous: f.status, changed: cols.length > 0 };
  });
}

// Is the PASS verdict still evidence for what HEAD is? Never blocks a ship
// (squash merges and rebases rewrite ancestry legitimately) — it only warns.
// Returns null, or { message, reasons, commit, head, help }. `probe` answers
// "is commit an ancestor of HEAD" (true / false / null = unknown).
export function shipWarning(slug, verdict, { head, probe }) {
  if (!verdict || verdict.verdict !== "PASS") return null;
  const reasons = [];
  const r = `PASS verification (round ${verdict.round})`;
  if (!verdict.commit) reasons.push(`${r} recorded no commit`);
  else {
    const inHead = probe(verdict.commit);
    if (inHead === false) reasons.push(`${r} was taken on ${verdict.commit}, which is not an ancestor of HEAD${head ? ` ${head}` : ""}`);
    else if (inHead !== true) reasons.push(`${r} commit ${verdict.commit} is unknown in this checkout`);
  }
  if (verdict.dirty) reasons.push(`${r} was recorded on a dirty tree (uncommitted changes)`);
  if (!reasons.length) return null;
  return {
    message: reasons.join("; "),
    reasons,
    commit: verdict.commit || null,
    head: head || null,
    help: [
      `Re-verify on the current HEAD: run the brain-verify skill, then brain verifications add ${slug} --verdict PASS --body "..."`,
    ],
  };
}

// Ship a feature. Preconditions: evidence, no open tasks, and the latest
// verification is PASS. Returns a structured outcome:
//   { outcome: "shipped" | "already-shipped", feature, previous, checkpoint, warning }
// A refusal throws BrainError SHIP_REFUSED (exit 1) whose help is built from
// the declared verify_checks, never a hardcoded runner (#4). The checkpoint
// summary is clipped with a trailing … — the full evidence stays on the row (#5).
// `warning` (see shipWarning) flags a PASS whose commit is not in HEAD, is
// unknown, or was recorded dirty — the ship still happens.
export function ship(db, slug, { evidence, root } = {}) {
  if (typeof evidence !== "string" || !evidence.trim())
    throw new BrainError("EVIDENCE_REQUIRED", "evidence is required to ship", [
      `brain features ship ${slug} --evidence "<what proves it works>"`,
    ]);
  // git probes run before taking the write lock; the in-lock verdict reuses
  // them unless its commit changed in between (then it probes again).
  const cwd = root || process.cwd();
  const branch = gitBranch(cwd) || "none";
  const head = gitHead(cwd);
  const probed = new Map();
  const probe = (c) => {
    if (!probed.has(c)) probed.set(c, gitIsAncestor(cwd, c));
    return probed.get(c);
  };
  const pre = latestVerdict(db, slug);
  if (pre && pre.commit) probe(pre.commit);
  return tx(db, () => {
    const f = lookup(db, slug);
    if (f.status === "shipped") return { outcome: "already-shipped", feature: f, previous: "shipped", checkpoint: null, warning: null };
    const reasons = [];
    const open = db
      .prepare(`SELECT key FROM tasks WHERE feature_id = ? AND status IN ${OPEN_TASK} ORDER BY id`)
      .all(f.id)
      .map((r) => r.key);
    if (open.length) reasons.push(`open tasks: ${open.join(", ")}`);
    const verdict = latestVerdict(db, f.slug);
    if (!verdict) reasons.push("no verification recorded");
    else if (verdict.verdict !== "PASS") reasons.push(`latest verification (round ${verdict.round}) is ${verdict.verdict}`);
    if (reasons.length)
      throw new BrainError(
        "SHIP_REFUSED",
        `ship ${f.slug} refused — ${reasons.join("; ")}; nothing was written`,
        [
          ...(open.length ? [`Close or cut each open task: brain tasks set ${f.slug} <task> --status done|cut`] : []),
          ...shipHint(db, f.slug),
        ],
        { feature: f.slug, status: f.status, reasons }
      );
    const at = now();
    db.prepare("UPDATE features SET status = 'shipped', evidence = ?, updated = ? WHERE id = ?").run(evidence, at, f.id);
    const prefix = `shipped ${f.slug}: `;
    const summary = clipChars(prefix + evidence, SUMMARY_MAX_CHARS);
    const checkpoint = progress.add(db, {
      summary,
      body: evidence,
      feature: f.slug,
      branch,
    });
    return {
      outcome: "shipped",
      feature: lookup(db, f.slug),
      previous: f.status,
      checkpoint: { ...checkpoint, clipped: summary !== prefix + evidence },
      warning: shipWarning(f.slug, verdict, { head, probe }),
    };
  });
}

// { total, by_status: {status: n}, in_progress: slug | null }
export function stats(db) {
  const by = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of db.prepare("SELECT status, count(*) AS n FROM features GROUP BY status").all()) by[r.status] = r.n;
  const ip = db.prepare("SELECT slug FROM features WHERE status = 'in-progress'").get();
  return { total: Object.values(by).reduce((a, b) => a + b, 0), by_status: by, in_progress: ip ? ip.slug : null };
}
