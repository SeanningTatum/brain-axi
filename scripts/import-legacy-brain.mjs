#!/usr/bin/env node
// scripts/import-legacy-brain.mjs — ONE-OFF, repo-dev only, never shipped.
// Builds this repo's .brain/brain.db from the live parts of the markdown-era
// .brain/ (axi-core bridge, phase 2; re-run from scratch in phase 5 after the
// docs are rewritten; deleted in phase 6). The old files are left in place
// and frozen read-only until phase 5 deletes them.
//
// Imports:
//   - docs: rules/, recipes/, codebase/ (minus index.md, _TEMPLATE.md and
//     rules/state.md, which the schema replaces), high-level-architecture/
//     architecture.md → architecture, features/<slug>/<slug>.md → features
//   - features/feature_list.json → features rows (status, description,
//     evidence, deps) + features/<slug>/pr.json → pr_url; shipped features
//     have no verification row here, so they come in grandfathered
//   - verify.json → verify_checks, REWRITTEN (its 4 checks call deleted code):
//     test (node --test), check-skills, harness (brain check)
//   - runs/progress.md → the newest checkpoint, plus a "brain rebuilt" one
//   - the in-progress feature's run notes (features/<slug>/runs/*.md) → run_steps
//   - the axi-core plan → plans row (path + sha256), round 1, approved
//
// Usage: node scripts/import-legacy-brain.mjs [--repo <dir>] [--dry-run]
// Refuses when .brain/brain.db already exists (move it aside to re-run).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as brain from "../lib/brain/index.js";
import { ensureGitignore } from "../lib/brain/db.js";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const REPO = path.resolve(flag("--repo") || path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DRY = args.includes("--dry-run");
const OLD = path.join(REPO, ".brain");
const DB_PATH = path.join(OLD, "brain.db");
const PLAN = { file: "plans/2026-10-10-axi-architecture.html", slug: "2026-10-10-axi-architecture", feature: "axi-core", approvedBy: "sean" };

const die = (msg) => {
  process.stdout.write(`error: ${JSON.stringify(msg)}\n`);
  process.exit(1);
};
const read = (...p) => fs.readFileSync(path.join(OLD, ...p), "utf8");
const exists = (...p) => fs.existsSync(path.join(OLD, ...p));
const mdFiles = (dir) =>
  exists(dir)
    ? fs.readdirSync(path.join(OLD, dir)).filter((f) => f.endsWith(".md") && f !== "index.md" && !f.startsWith("_")).sort()
    : [];

if (!exists("features", "feature_list.json")) die(`${OLD} has no features/feature_list.json — not a legacy brain`);
if (fs.existsSync(DB_PATH)) die(`${DB_PATH} already exists — move it aside to re-run the import`);

// ---------------------------------------------------------------------------
// Collect
// ---------------------------------------------------------------------------

const docs = [];
for (const [dir, section, skip] of [
  ["rules", "rules", ["state.md"]],
  ["recipes", "recipes", []],
  ["codebase", "codebase", []],
]) {
  for (const f of mdFiles(dir)) if (!skip.includes(f)) docs.push({ section, name: f.replace(/\.md$/, ""), body: read(dir, f) });
}
if (exists("high-level-architecture", "architecture.md"))
  docs.push({ section: "architecture", name: "architecture", body: read("high-level-architecture", "architecture.md") });

const tracker = JSON.parse(read("features", "feature_list.json"));
const legacy = tracker.features;
for (const f of legacy) {
  if (exists("features", f.slug, `${f.slug}.md`)) docs.push({ section: "features", name: f.slug, body: read("features", f.slug, `${f.slug}.md`) });
  if (exists("features", f.slug, "pr.json")) f.pr_url = JSON.parse(read("features", f.slug, "pr.json")).url;
}

// Topological order: a feature's dependencies are added before it.
const bySlug = new Map(legacy.map((f) => [f.slug, f]));
const ordered = [];
const seen = new Set();
const visit = (f) => {
  if (seen.has(f.slug)) return;
  seen.add(f.slug);
  for (const d of f.dependencies || []) if (bySlug.has(d)) visit(bySlug.get(d));
  ordered.push(f);
};
legacy.forEach(visit);

// Newest checkpoint: the first entry after the preamble's `---`.
const entries = read("runs", "progress.md").split(/\n---+\n/).slice(1).map((e) => e.trim()).filter((e) => e.startsWith("## "));
const newest = entries[0];
const cp = newest && {
  summary: /^## (?:\S+ )?(?:\d\d:\d\d \S+ )?— (.+)$/m.exec(newest)?.[1] || newest.split("\n")[0].replace(/^## /, ""),
  date: /^## (\d{4}-\d{2}-\d{2})/.exec(newest)?.[1],
  branch: /^- branch: `?([^`\n]+)`?$/m.exec(newest)?.[1],
  next: /^- next: (.+)$/m.exec(newest)?.[1] || null,
  body: newest,
};

// The in-progress feature's run notes: "## Step N — <step>" + a fenced block.
const live = legacy.find((f) => f.status === "in-progress");
const steps = [];
if (live && exists("features", live.slug, "runs"))
  for (const f of fs.readdirSync(path.join(OLD, "features", live.slug, "runs")).filter((x) => x.endsWith(".md")).sort()) {
    const run = f.replace(/\.md$/, "");
    for (const m of read("features", live.slug, "runs", f).matchAll(/^## Step \d+ — (.+)\n+```[^\n]*\n([\s\S]*?)\n```/gm))
      steps.push({ run, step: m[1].trim(), observed: m[2] });
  }

const checks = [
  { name: "test", run: "node --test", stages: ["bootstrap", "baseline", "verify"] },
  { name: "check-skills", run: "node scripts/check-skills.mjs", stages: ["bootstrap", "baseline", "verify"] },
  { name: "harness", run: "node bin/brain.js check", stages: ["bootstrap", "baseline", "verify"] },
];

// ---------------------------------------------------------------------------
// Build in a temp dir, then move into place (create() refuses a legacy brain)
// ---------------------------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brain-import-"));
const b = brain.create(tmp, { gitignore: false });
const db = b.db;
try {
  for (const f of ordered) {
    const shipped = f.status === "shipped";
    brain.features.add(db, {
      slug: f.slug,
      name: f.name,
      description: f.description || null,
      dependsOn: (f.dependencies || []).filter((d) => bySlug.has(d)),
      status: f.status,
      evidence: f.evidence || (shipped ? "imported from the legacy feature_list.json (no evidence recorded)" : null),
      grandfathered: shipped,
      prUrl: f.pr_url || null,
    });
  }
  for (const d of docs) brain.docs.set(db, d.section, d.name, d.body);
  for (const c of checks) brain.verify.addCheck(db, c);
  for (const s of steps) brain.runs.append(db, live.slug, { run: s.run, step: s.step, observed: s.observed, author: "import-legacy-brain" });
  if (cp)
    brain.progress.add(db, {
      summary: cp.summary,
      next: cp.next,
      body: `imported from runs/progress.md (newest entry, ${cp.date || "undated"}):\n\n${cp.body}`,
      branch: cp.branch || "none",
      clip: true,
      root: REPO,
    });
  if (fs.existsSync(path.join(REPO, PLAN.file))) {
    brain.plans.upsert(db, { file: PLAN.file, slug: PLAN.slug, feature: PLAN.feature, root: REPO });
    brain.plans.endSession(db, PLAN.slug, { approvedBy: PLAN.approvedBy });
  }
  brain.progress.add(db, {
    summary: "brain rebuilt: legacy markdown .brain imported into brain.db (axi-core phase 2 bridge)",
    next: live ? `continue ${live.slug}; old .brain/ markdown is frozen read-only until phase 5 deletes it` : null,
    feature: live ? live.slug : undefined,
    root: REPO,
  });
} finally {
  brain.close(db);
}

const counts = {
  features: ordered.length,
  grandfathered: ordered.filter((f) => f.status === "shipped").length,
  docs: docs.length,
  verify_checks: checks.length,
  run_steps: steps.length,
  checkpoints: (cp ? 1 : 0) + 1,
  plans: fs.existsSync(path.join(REPO, PLAN.file)) ? 1 : 0,
};

if (!DRY) {
  fs.copyFileSync(path.join(tmp, ".brain", "brain.db"), DB_PATH);
  ensureGitignore(REPO, OLD);
  const check = brain.openBrain(REPO);
  const rows = brain.check(check.db, { root: REPO });
  brain.close(check.db);
  const failed = rows.filter((r) => r.status !== "pass");
  if (failed.length) die(`imported, but brain check fails: ${failed.map((r) => `${r.check}: ${r.detail}`).join("; ")}`);
}
fs.rmSync(tmp, { recursive: true, force: true });

process.stdout.write(
  [
    "import-legacy-brain:",
    `  db: ${DRY ? "(dry run — nothing written)" : path.relative(process.cwd(), DB_PATH)}`,
    ...Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`),
    `help[1]: Run \`node bin/brain.js check\` and \`node bin/brain.js features list\``,
  ].join("\n") + "\n"
);
