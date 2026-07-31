#!/usr/bin/env node
// brain — AXI-compliant CLI over a .brain agent harness directory.
// stdout: TOON-structured data/errors for agents. stderr: diagnostics only.
// Exit codes: 0 success (incl. no-ops), 1 operation error, 2 usage error.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  listPlans,
  getPlan,
  listShots,
  addShot,
  timeline as brainTimeline,
  listVerifications,
  getVerification,
  appendRunStep,
  brainCheck,
  recordPr,
  listAnnotations,
} from "../lib/review/brain-data.js";
import {
  STATUSES,
  featureListPath,
  saveFeatureList,
  writeFileAtomic,
  validateFeatureListShape,
  validateFeatureListStructure,
  oneInProgressEnforced,
  gitShortHead,
  gitWorktreeDirty,
  isGitRepo,
  parseReceipt,
  parseVerdictDetail,
  VERDICT_ACCEPTED,
} from "../lib/state.js";
import { sessionKey, stateDir, listSessions } from "../lib/review/store.js";
import { PLAYBOOKS } from "../lib/review/playbooks.js";
import {
  listSuiteNames,
  loadSuite,
  suiteRows,
  lastRun,
  runScore,
  formatScore,
  isStale,
  repoRoot,
  evalChecks,
  evalsDir,
  adaptRunOutput,
  scoreRun,
  recordRun,
  gateVerdict,
  appendCase,
  freezeCase,
  CASE_ORIGINS,
  EVAL_ADAPTERS,
  SUITE_SNIPPET,
} from "../lib/review/evals.js";

const BIN_PATH = fileURLToPath(import.meta.url);
const DESCRIPTION =
  "Query and update the .brain agent harness (features, progress, docs, runs) in the current repo";
const OWN_VERSION = readOwnVersion();
const REVIEW_DEFAULT_PORT = 4517;
const SERVER_PATH = fileURLToPath(new URL("../lib/review/server.js", import.meta.url));

function readOwnVersion() {
  try {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    return JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
  } catch {
    return "0.0.0";
  }
}

// ---------------------------------------------------------------------------
// TOON serialization (toonformat.dev)
// ---------------------------------------------------------------------------

function toonScalar(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "null";
    return String(Object.is(v, -0) ? 0 : v);
  }
  if (typeof v === "boolean") return String(v);
  return toonString(String(v));
}

function toonString(s) {
  const needsQuote =
    s === "" ||
    /[",:\n\r\t|]/.test(s) ||
    /^\s|\s$/.test(s) ||
    /^(true|false|null)$/.test(s) ||
    /^-?\d/.test(s) ||
    s.startsWith("-");
  if (!needsQuote) return s;
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

function kv(key, value, indent = 0) {
  return `${" ".repeat(indent)}${key}: ${toonScalar(value)}`;
}

// Tabular array: name[N]{f1,f2}: + one CSV row per item.
function toonTable(name, rows, fields, indent = 0) {
  const pad = " ".repeat(indent);
  const lines = [`${pad}${name}[${rows.length}]{${fields.join(",")}}:`];
  for (const row of rows) {
    lines.push(pad + "  " + fields.map((f) => toonScalar(row[f])).join(","));
  }
  return lines;
}

// List array of display strings (help hints etc.). Single item stays inline.
function toonList(name, items, indent = 0) {
  const pad = " ".repeat(indent);
  if (items.length === 1) return [`${pad}${name}[1]: ${items[0]}`];
  const lines = [`${pad}${name}[${items.length}]:`];
  for (const item of items) lines.push(pad + "  " + item);
  return lines;
}

function print(lines) {
  process.stdout.write(lines.join("\n") + "\n");
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function usageError(message, helpLines) {
  print([`error: ${message}`, ...toonList("help", helpLines)]);
  process.exit(2);
}

function opError(message, helpLines) {
  print([`error: ${message}`, ...toonList("help", helpLines)]);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Flag parsing — per-command flag sets, unknown flags rejected (exit 2)
// ---------------------------------------------------------------------------

// spec: { "--flag": { value: bool, desc: string } }. --help and --brain are
// always-allowed globals on every command.
const GLOBAL_FLAGS = {
  "--help": { value: false, desc: "show help for this command" },
  "--brain": { value: true, desc: "path to the .brain directory (default: walk up from cwd)" },
};

function parseArgs(argv, spec, commandLabel) {
  const merged = { ...GLOBAL_FLAGS, ...spec };
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positionals.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq === -1 ? a : a.slice(0, eq);
    const def = merged[name];
    if (!def) {
      const valid = Object.keys(merged).sort().join(", ");
      usageError(`unknown flag ${name} for \`${commandLabel}\``, [
        `valid flags for \`${commandLabel}\`: ${valid}`,
        `Run \`brain ${commandLabel} --help\` for usage`,
      ]);
    }
    if (def.value) {
      let v;
      if (eq !== -1) v = a.slice(eq + 1);
      else {
        v = argv[++i];
        if (v === undefined) {
          usageError(`flag ${name} requires a value`, [
            `Run \`brain ${commandLabel} --help\` for usage`,
          ]);
        }
      }
      flags[name.slice(2)] = v;
    } else {
      if (eq !== -1)
        usageError(`flag ${name} does not take a value`, [
          `Run \`brain ${commandLabel} --help\` for usage`,
        ]);
      flags[name.slice(2)] = true;
    }
  }
  return { flags, positionals };
}

function helpBlock(commandLabel, summary, spec, examples, args = []) {
  const lines = [kv("command", `brain ${commandLabel}`), kv("summary", summary)];
  if (args.length) lines.push(...toonList("args", args));
  const merged = { ...spec, ...GLOBAL_FLAGS };
  const flagLines = Object.entries(merged).map(
    ([f, d]) => `${f}${d.value ? " <value>" : ""} — ${d.desc}`
  );
  lines.push(...toonList("flags", flagLines));
  lines.push(...toonList("examples", examples));
  print(lines);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Brain discovery + data loaders
// ---------------------------------------------------------------------------

function findBrain(explicit, { optional = false } = {}) {
  if (explicit) {
    const p = path.resolve(explicit);
    if (fs.existsSync(p)) return p;
    if (optional) return null;
    opError(`no .brain directory at ${p}`, ["Pass --brain <path> pointing at an existing .brain directory"]);
  }
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, ".brain");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) {
      if (optional) return null;
      opError("no .brain directory found walking up from cwd", [
        "Run inside a repo with a .brain directory, or pass --brain <path>",
      ]);
    }
    dir = parent;
  }
}

function relBrain(brain) {
  const rel = path.relative(process.cwd(), brain);
  return rel === "" ? "." : rel;
}

function collapseHome(p) {
  const home = os.homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

// STATUSES and featureListPath now come from lib/state.js (imported above) so
// the schema has ONE definition shared with brainCheck.

function loadFeatureList(brain) {
  const p = featureListPath(brain);
  if (!fs.existsSync(p))
    opError(`missing ${path.relative(process.cwd(), p)}`, [
      "Create features/feature_list.json in the brain, or check --brain path",
    ]);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    opError(`feature_list.json is not valid JSON (${e.message})`, [
      `Fix the JSON in ${path.relative(process.cwd(), p)}`,
    ]);
  }
  // STRUCTURE only, deliberately. Every caller below trusts
  // list.features.find/map unconditionally, so a non-array `features` must hard
  // fail rather than throw a bare TypeError. But field-level problems (a legacy
  // shipped record with no evidence, say) must NOT block reads — otherwise the
  // only way to repair the record is hand-editing JSON, and `features
  // set-status` — the repair tool — is exactly what gets locked out.
  // `brain check` owns full-field validation.
  const structureError = validateFeatureListStructure(parsed);
  if (structureError)
    opError(`feature_list.json is invalid: ${structureError}`, [
      `Fix ${path.relative(process.cwd(), p)}, then run \`brain check\``,
    ]);
  // Surface field problems without blocking: stderr keeps stdout a clean TOON
  // payload (rules/toon-axi.md) while still telling the operator.
  const shapeError = validateFeatureListShape(parsed);
  if (shapeError) process.stderr.write(`warning: feature_list.json: ${shapeError} (run \`brain check\`)\n`);
  return parsed;
}

// progress.md: preamble, then entries separated by lines of "---".
function parseProgress(brain) {
  const p = path.join(brain, "runs", "progress.md");
  if (!fs.existsSync(p)) return { path: p, entries: [], raw: null };
  const raw = fs.readFileSync(p, "utf8");
  const parts = raw.split(/\n---+\n/);
  const entries = [];
  for (const part of parts.slice(1)) {
    const m = part.match(/^\s*## (.+)$/m);
    if (!m) continue;
    const header = m[1].trim();
    const date = (header.match(/^(\d{4}-\d{2}-\d{2})/) || [null, ""])[1];
    const summary = header.replace(/^\d{4}-\d{2}-\d{2}\s*(?:\d{2}:\d{2}\s*(?:\(UTC\))?\s*)?[—-]*\s*/, "");
    entries.push({ date, summary, body: part.trim() });
  }
  return { path: p, entries, raw };
}

function firstHeading(file) {
  try {
    const m = fs.readFileSync(file, "utf8").match(/^# (.+)$/m);
    return m ? m[1].trim() : path.basename(file, ".md");
  } catch {
    return path.basename(file, ".md");
  }
}

function listMd(dir, { excludeIndex = true } = {}) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => !f.startsWith("_TEMPLATE"))
    .filter((f) => !excludeIndex || f !== "index.md")
    .sort()
    .map((f) => ({ name: f.replace(/\.md$/, ""), file: path.join(dir, f) }));
}

const DOC_SECTIONS = {
  rules: "rules",
  recipes: "recipes",
  codebase: "codebase",
  architecture: "high-level-architecture",
  features: "features",
  emails: "emails",
  transcripts: "transcripts",
};

// verify.json: a declared registry of project checks (typecheck, tests, lint,
// e2e, ...) that `brain verify` runs sequentially. VERIFY_STAGES are the only
// legal values inside a check's `stages` array.
const VERIFY_STAGES = ["bootstrap", "baseline", "verify"];
// `evals` is a stage of `brain verify` but NOT a legal stage inside
// verify.json: eval suites are declared in .brain/evals/, and the gate logic
// (frozen cases, tolerance bands) lives in brain, not in a shell string.
const ALL_VERIFY_STAGES = [...VERIFY_STAGES, "evals"];
const VERIFY_SNIPPET =
  '{"version":1,"checks":[{"name":"typecheck","run":"bun run typecheck","stages":["baseline","verify"]}]}';

function verifyConfigPath(brain) {
  return path.join(brain, "verify.json");
}

// Validates the parsed verify.json shape; returns null when valid, else a
// precise message naming the exact bad field.
function validateVerifyShape(parsed) {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return "verify.json must be a JSON object";
  if (!Array.isArray(parsed.checks)) return `"checks" must be an array`;
  const names = new Set();
  for (let i = 0; i < parsed.checks.length; i++) {
    const c = parsed.checks[i];
    const at = `checks[${i}]`;
    if (typeof c !== "object" || c === null || Array.isArray(c)) return `${at} must be an object`;
    if (typeof c.name !== "string" || !c.name.trim()) return `${at}.name must be a non-empty string`;
    if (names.has(c.name)) return `${at}.name "${c.name}" is not unique`;
    names.add(c.name);
    if (typeof c.run !== "string" || !c.run.trim()) return `${at}.run must be a non-empty string`;
    if (!Array.isArray(c.stages) || c.stages.length === 0) return `${at}.stages must be a non-empty array`;
    const badStage = c.stages.find((s) => !VERIFY_STAGES.includes(s));
    if (badStage !== undefined)
      return `${at}.stages contains invalid stage "${badStage}" (valid: ${VERIFY_STAGES.join("|")})`;
    if (c.timeout !== undefined && (typeof c.timeout !== "number" || !Number.isFinite(c.timeout) || c.timeout <= 0))
      return `${at}.timeout must be a positive number (seconds)`;
  }
  return null;
}

// Loads + validates .brain/verify.json. Never throws — mirrors
// loadFeatureList/parseProgress's read style, but (unlike loadFeatureList)
// hands the structured error back instead of calling opError itself, since
// callers (cmdCheck vs cmdVerify) react to a missing/malformed file
// differently. Returns { config, error } where error is null on success or
// { kind: "missing"|"parse"|"shape", message }.
function loadVerifyConfig(brain) {
  const p = verifyConfigPath(brain);
  const rel = path.relative(process.cwd(), p);
  if (!fs.existsSync(p)) return { config: null, error: { kind: "missing", message: `missing ${rel}` } };
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    return { config: null, error: { kind: "missing", message: `could not read ${rel} (${e.message})` } };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { config: null, error: { kind: "parse", message: `${rel} is not valid JSON (${e.message})` } };
  }
  const shapeError = validateVerifyShape(parsed);
  if (shapeError) return { config: null, error: { kind: "shape", message: `${rel}: ${shapeError}` } };
  return { config: parsed, error: null };
}

// ---------------------------------------------------------------------------
// Content truncation
// ---------------------------------------------------------------------------

function bodyLines(label, content, { full, limit = 1200, fullCommand }) {
  const lines = [];
  if (full || content.length <= limit) {
    lines.push(`${label}: |`);
    for (const l of content.split("\n")) lines.push("  " + l);
  } else {
    lines.push(`${label}: |`);
    for (const l of content.slice(0, limit).split("\n")) lines.push("  " + l);
    lines.push(`  ... (truncated, ${content.length} chars total)`);
    lines.push(...toonList("help", [`Run \`${fullCommand}\` to see complete ${label}`]));
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function featureStats(list) {
  const counts = {};
  for (const f of list.features) counts[f.status] = (counts[f.status] || 0) + 1;
  return counts;
}

function cmdHome(argv) {
  const { flags } = parseArgs(argv, {}, "");
  if (flags.help)
    helpBlock("", "Home view: live brain state + entry points", {}, [
      "brain", "brain features", "brain search \"<query>\"",
    ]);
  const brain = findBrain(flags.brain);
  const list = loadFeatureList(brain);
  const progress = parseProgress(brain);
  const counts = featureStats(list);
  const inProgress = list.features.filter((f) => f.status === "in-progress");

  const lines = [
    kv("bin", collapseHome(BIN_PATH)),
    kv("description", DESCRIPTION),
    kv("brain", relBrain(brain)),
    kv(
      "features",
      `${list.features.length} total (${Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(", ")})`
    ),
    kv("in-progress", inProgress.length ? inProgress.map((f) => f.slug).join(", ") : "none"),
  ];
  if (progress.entries.length) {
    const top = progress.entries[0];
    lines.push(kv("last-checkpoint", `${top.date} — ${top.summary}`));
  }

  // Eval state, when the repo has any: one line, with the suites that need
  // attention named. A stale or regressed suite that only shows up when
  // someone remembers to type `brain evals` is a gate nobody is watching.
  const evalRows = suiteRows(brain);
  if (evalRows.length) {
    const attention = evalRows.filter((r) => r.state !== "ok");
    lines.push(
      kv(
        "evals",
        `${evalRows.length} suite(s)` +
          (attention.length
            ? ` — ${attention.map((r) => `${r.suite} ${r.state}`).join(", ")}`
            : ` — all ok (${evalRows.map((r) => `${r.suite} ${r.score}`).join(", ")})`)
      )
    );
  }

  // Phase-1 adoption: surface open review sessions, cheap (reads the local
  // session store directly, no server round-trip).
  let sessions = [];
  try {
    sessions = listSessions().filter((s) => s.status !== "ended");
  } catch {
    sessions = [];
  }
  if (sessions.length) {
    lines.push(
      ...toonTable(
        "sessions",
        sessions.map((s) => ({ key: s.key, status: s.status, plan: s.plan || "", file: s.file })),
        ["key", "status", "plan", "file"]
      )
    );
  }

  lines.push(
    ...toonList("help", [
      "Run `brain features` to list features with status",
      "Run `brain progress` to see the latest session checkpoint in full",
      "Run `brain docs` to browse rules, recipes, and architecture docs",
      "Run `brain search \"<query>\"` to find text anywhere in the brain",
      "Run `brain review <plan.html>` to open a human review session",
      "Run `brain check` to verify harness invariants",
      "Run `brain setup --app claude` to install a session-start context hook",
    ])
  );
  print(lines);
}

// Generated features/index.md table. Drift between the tracker and this
// hand-maintained mirror is now DETECTED, but detection still means a human
// notices and fixes it — generating retires the class instead. Bounded by
// markers so surrounding prose is never clobbered.
const FEATURES_TABLE_OPEN = "<!-- brain:features-table -->";
const FEATURES_TABLE_CLOSE = "<!-- /brain:features-table -->";

function buildFeaturesTable(brain, list) {
  const rows = list.features.map((f) => {
    const docs = listVerifications(brain, f.slug);
    const latest = docs[0];
    const mark = latest
      ? `[${latest.date} ${latest.verdict}](${f.slug}/verifications/${latest.date}.md)`
      : "—";
    return `| ${f.name} | [\`${f.slug}/${f.slug}.md\`](${f.slug}/${f.slug}.md) | ${f.status} | ${mark} |`;
  });
  return [
    "| Feature | Memo | Status | Latest verification |",
    "|---------|------|--------|---------------------|",
    ...rows,
  ].join("\n");
}

// Rewrite the generated table in place. Returns "written" | "unchanged" |
// "no-markers" | "missing" — never throws, because a ship must not fail on a
// derived doc.
function regenerateFeaturesIndex(brain) {
  try {
    const indexPath = path.join(brain, "features", "index.md");
    if (!fs.existsSync(indexPath)) return "missing";
    const content = fs.readFileSync(indexPath, "utf8");
    const open = content.indexOf(FEATURES_TABLE_OPEN);
    const close = content.indexOf(FEATURES_TABLE_CLOSE);
    if (open === -1 || close === -1 || close < open) return "no-markers";
    const list = JSON.parse(fs.readFileSync(featureListPath(brain), "utf8"));
    const table = buildFeaturesTable(brain, list);
    const next =
      content.slice(0, open + FEATURES_TABLE_OPEN.length) + "\n" + table + "\n" + content.slice(close);
    if (next === content) return "unchanged";
    writeFileAtomic(indexPath, next);
    return "written";
  } catch {
    return "missing";
  }
}

function cmdFeaturesIndex(argv) {
  const spec = {
    "--write": { value: false, desc: "write the table into features/index.md between its markers" },
    "--create": { value: false, desc: "with --write: create features/index.md (with markers) when absent" },
  };
  const { flags } = parseArgs(argv, spec, "features index");
  if (flags.help)
    helpBlock(
      "features index",
      "Generate the features/index.md status table from feature_list.json (the source of truth)",
      spec,
      ["brain features index", "brain features index --write"]
    );
  const brain = findBrain(flags.brain);
  const list = loadFeatureList(brain);
  const table = buildFeaturesTable(brain, list);
  const indexPath = path.join(brain, "features", "index.md");

  if (!flags.write) {
    print([
      "table: |",
      ...table.split("\n").map((l) => "  " + l),
      ...toonList("help", [
        `Run \`brain features index --write\` to write it into ${path.relative(process.cwd(), indexPath)}`,
        `The target must contain ${FEATURES_TABLE_OPEN} and ${FEATURES_TABLE_CLOSE} markers`,
      ]),
    ]);
    return;
  }

  if (!fs.existsSync(indexPath)) {
    if (!flags.create)
      opError(`missing ${path.relative(process.cwd(), indexPath)}`, [
        `Run \`brain features index --write --create\` to scaffold it`,
        `Or create it with the ${FEATURES_TABLE_OPEN} / ${FEATURES_TABLE_CLOSE} markers around the table`,
      ]);
    writeFileAtomic(
      indexPath,
      [
        "# Features",
        "",
        "> **Generated between the markers — do not hand-edit.** Run `brain features index --write`.",
        "> `feature_list.json` is the source of truth; `brain check` fails on any disagreement.",
        "",
        FEATURES_TABLE_OPEN,
        FEATURES_TABLE_CLOSE,
        "",
      ].join("\n")
    );
  }
  const content = fs.readFileSync(indexPath, "utf8");
  const open = content.indexOf(FEATURES_TABLE_OPEN);
  const close = content.indexOf(FEATURES_TABLE_CLOSE);
  if (open === -1 || close === -1 || close < open)
    opError("features/index.md has no brain:features-table markers", [
      `Wrap the status table in ${FEATURES_TABLE_OPEN} … ${FEATURES_TABLE_CLOSE}`,
      "Markers keep generation from clobbering the surrounding prose",
    ]);

  const next =
    content.slice(0, open + FEATURES_TABLE_OPEN.length) + "\n" + table + "\n" + content.slice(close);
  const changed = next !== content;
  if (changed) writeFileAtomic(indexPath, next);
  print([
    "features index:",
    kv("file", path.relative(process.cwd(), indexPath), 2),
    kv("rows", list.features.length, 2),
    kv("action", changed ? "written" : "already up to date", 2),
    ...toonList("help", [
      changed
        ? "Run `brain check` to confirm the tracker and the index now agree"
        : "Nothing to do — the generated table already matches the tracker",
    ]),
  ]);
}

function cmdFeatures(argv) {
  const sub = argv[0] && !argv[0].startsWith("--") ? argv[0] : "list";
  const rest = sub === argv[0] ? argv.slice(1) : argv;

  if (sub === "list") return cmdFeaturesList(rest);
  if (sub === "view") return cmdFeaturesView(rest);
  if (sub === "set-status") return cmdFeaturesSetStatus(rest);
  if (sub === "index") return cmdFeaturesIndex(rest);
  usageError(`unknown subcommand \`features ${sub}\``, [
    "valid subcommands: list (default), view <slug>, set-status <slug> --status <status>",
  ]);
}

const FEATURE_FIELDS = ["id", "name", "slug", "status", "description", "dependencies", "evidence", "owners", "doc"];

function cmdFeaturesList(argv) {
  const spec = {
    "--status": { value: true, desc: `filter by status (${STATUSES.join("|")})` },
    "--fields": { value: true, desc: "comma-separated extra fields (default: id,slug,status)" },
    "--limit": { value: true, desc: "max rows (default: 100)" },
  };
  const { flags } = parseArgs(argv, spec, "features list");
  if (flags.help)
    helpBlock("features list", "List features from feature_list.json", spec, [
      "brain features",
      "brain features --status in-progress",
      "brain features --fields id,slug,status,description",
    ]);
  const brain = findBrain(flags.brain);
  const list = loadFeatureList(brain);

  let rows = list.features;
  if (flags.status) {
    if (!STATUSES.includes(flags.status))
      usageError(`invalid --status "${flags.status}"`, [`valid statuses: ${STATUSES.join(", ")}`]);
    rows = rows.filter((f) => f.status === flags.status);
  }
  const total = rows.length;
  const limit = flags.limit ? parseInt(flags.limit, 10) : 100;
  if (!Number.isInteger(limit) || limit < 1)
    usageError(`invalid --limit "${flags.limit}"`, ["--limit takes a positive integer"]);
  rows = rows.slice(0, limit);

  let fields = ["id", "slug", "status"];
  if (flags.fields) {
    fields = flags.fields.split(",").map((s) => s.trim());
    const bad = fields.filter((f) => !FEATURE_FIELDS.includes(f));
    if (bad.length)
      usageError(`unknown field(s): ${bad.join(", ")}`, [`valid fields: ${FEATURE_FIELDS.join(", ")}`]);
  }

  if (total === 0) {
    print([
      `features: 0 features${flags.status ? ` with status ${flags.status}` : ""} in this brain`,
      ...toonList("help", ["Run `brain features` for all features"]),
    ]);
    return;
  }

  const display = rows.map((f) => ({
    ...f,
    dependencies: (f.dependencies || []).join(" "),
    owners: (f.owners || []).join(" "),
  }));
  const lines = [];
  if (rows.length < total) lines.push(kv("count", `${rows.length} of ${total} total`));
  lines.push(...toonTable("features", display, fields));
  const help = ["Run `brain features view <slug>` for full details + doc"];
  if (rows.length < total) help.push(`Run \`brain features --limit ${total}\` for all ${total} features`);
  help.push("Run `brain features set-status <slug> --status <status>` to update state");
  lines.push(...toonList("help", help));
  print(lines);
}

function cmdFeaturesView(argv) {
  const spec = { "--full": { value: false, desc: "print the complete feature doc body" } };
  const { flags, positionals } = parseArgs(argv, spec, "features view");
  if (flags.help)
    helpBlock("features view", "Show one feature: tracker fields + doc body", spec,
      ["brain features view authentication", "brain features view preview-deployments --full"],
      ["<slug> — feature slug from `brain features`"]);
  const slug = positionals[0];
  if (!slug) usageError("missing required argument <slug>", ["brain features view <slug>  (see `brain features` for slugs)"]);
  const brain = findBrain(flags.brain);
  const list = loadFeatureList(brain);
  const feat = list.features.find((f) => f.slug === slug || f.id === slug);
  if (!feat)
    opError(`no feature "${slug}"`, [
      `known slugs: ${list.features.map((f) => f.slug).join(", ")}`,
    ]);

  const lines = ["feature:"];
  for (const k of ["id", "name", "slug", "status", "description", "evidence"])
    if (feat[k] !== undefined) lines.push(kv(k, feat[k], 2));
  if (feat.dependencies?.length) lines.push(kv("dependencies", feat.dependencies.join(" "), 2));
  if (feat.owners?.length) lines.push(kv("owners", feat.owners.join(" "), 2));

  let docPath = feat.doc ? path.resolve(path.dirname(featureListPath(brain)), "..", "..", feat.doc) : null;
  // feature_list.json's doc path may still name either convention (or the
  // file may have been migrated without updating the tracker) — fall back to
  // trying the other one before giving up.
  if (docPath && !fs.existsSync(docPath) && feat.slug) {
    const perFeature = path.join(brain, "features", feat.slug, `${feat.slug}.md`);
    const legacyFlat = path.join(brain, "features", `${feat.slug}.md`);
    if (fs.existsSync(perFeature)) docPath = perFeature;
    else if (fs.existsSync(legacyFlat)) docPath = legacyFlat;
  }
  if (docPath && fs.existsSync(docPath)) {
    lines.push(kv("doc", feat.doc, 2));
    lines.push(
      ...bodyLines("body", fs.readFileSync(docPath, "utf8").trim(), {
        full: !!flags.full,
        fullCommand: `brain features view ${slug} --full`,
      })
    );
  } else if (feat.doc) {
    lines.push(kv("doc", `${feat.doc} (file missing)`, 2));
  }
  print(lines);
}

function cmdFeaturesSetStatus(argv) {
  const spec = {
    "--status": { value: true, desc: `new status (${STATUSES.join("|")})` },
    "--evidence": { value: true, desc: "replace the evidence string" },
  };
  const { flags, positionals } = parseArgs(argv, spec, "features set-status");
  if (flags.help)
    helpBlock("features set-status", "Update a feature's status in feature_list.json", spec,
      ["brain features set-status file-upload --status in-progress",
       "brain features set-status file-upload --status shipped --evidence \"shipped 2026-07-13; tests green\""],
      ["<slug> — feature slug from `brain features`"]);
  const slug = positionals[0];
  if (!slug) usageError("missing required argument <slug>", ["brain features set-status <slug> --status <status>"]);
  if (!flags.status) usageError("--status is required", [`brain features set-status ${slug} --status <${STATUSES.join("|")}>`]);
  if (!STATUSES.includes(flags.status))
    usageError(`invalid --status "${flags.status}"`, [`valid statuses: ${STATUSES.join(", ")}`]);
  if (flags.status === "shipped" && (!flags.evidence || !flags.evidence.trim()))
    usageError("--evidence is required when setting status to shipped", [
      `brain features set-status ${slug} --status shipped --evidence "..."`,
      `Or run \`brain ship ${slug} --evidence "..."\` — it also checkpoints and runs \`brain check\``,
    ]);

  const brain = findBrain(flags.brain);
  const list = loadFeatureList(brain);
  const feat = list.features.find((f) => f.slug === slug || f.id === slug);
  if (!feat)
    opError(`no feature "${slug}"`, [`known slugs: ${list.features.map((f) => f.slug).join(", ")}`]);

  if (feat.status === flags.status && !flags.evidence) {
    print([`feature: ${feat.slug} already ${flags.status} (no-op)`]);
    return;
  }

  // Brain policy: at most one feature in-progress at a time. Shared helper —
  // this used to test `list.policy?.…` (absent policy = not enforced) while
  // brainCheck enforced it, so a brain with no policy key could be pushed into
  // a state `brain check` then failed.
  if (flags.status === "in-progress" && oneInProgressEnforced(list)) {
    const other = list.features.find((f) => f.status === "in-progress" && f !== feat);
    if (other)
      opError(`policy one_in_progress_at_a_time: ${other.slug} is already in-progress`, [
        `Run \`brain features set-status ${other.slug} --status shipped\` (or blocked/cut) first`,
      ]);
  }

  const previous = feat.status;

  // Transitions INTO shipped get the same preflight as `brain ship`. Without
  // this, `set-status --status shipped --evidence "..."` was a complete bypass
  // of the ship gate: it wrote shipped state with no brainCheck at all, so
  // hardening `ship` alone would have moved the hole rather than closed it.
  //
  // Only shipped is gated. Every other transition (including OUT of a bad
  // shipped record, back to planned/blocked/cut) stays unguarded on purpose —
  // gating de-escalations would lock the operator out of repairing exactly the
  // states that make a brain incoherent.
  if (flags.status === "shipped") {
    const projected = {
      ...list,
      features: list.features.map((f) =>
        f === feat ? { ...f, status: "shipped", evidence: flags.evidence || f.evidence } : f
      ),
    };
    // strict: shipping is the moment the claim is made, so proof is required
    // here even though ambient `brain check` leaves it opt-in.
    const checks = brainCheck(brain, { list: projected, strict: true, strictScope: feat.slug });
    const failed = checks.filter((c) => c.status === "fail");
    if (failed.length) {
      print([
        `feature: refused — ${failed.length} harness check(s) would fail`,
        kv("slug", feat.slug, 2),
        kv("status", `${previous} (unchanged — nothing was written)`, 2),
        ...toonTable("checks", checks, ["check", "status", "detail"]),
        ...toonList("help", [
          `Fix the failing detail(s) above, then re-run \`brain features set-status ${feat.slug} --status shipped --evidence "..."\``,
          `\`brain ship ${feat.slug} --evidence "..."\` applies the same gate and also checkpoints`,
        ]),
      ]);
      process.exit(1);
      return;
    }
  }

  feat.status = flags.status;
  if (flags.evidence) feat.evidence = flags.evidence;
  saveFeatureList(brain, list);

  // The derived index must follow EVERY status write, not just `ship`. Wiring it
  // into ship alone left `set-status` able to take the brain from green to red
  // while exiting 0 — the same "hardened one path, moved the hole" mistake the
  // ship gate already made once.
  const regenStatus = regenerateFeaturesIndex(brain);

  print([
    "feature:",
    kv("slug", feat.slug, 2),
    kv("status", feat.status, 2),
    kv("previous", previous, 2),
    ...(regenStatus === "written" ? [kv("index", "features/index.md regenerated", 2)] : []),
    ...(regenStatus === "no-markers"
      ? ["warning: features/index.md has no brain:features-table markers — update it by hand or `brain check` will report drift"]
      : []),
    ...(regenStatus === "missing"
      ? ["warning: features/index.md absent — run `brain features index --write --create`"]
      : []),
    ...toonList("help", [
      `Update the doc changelog in ${feat.doc || ".brain/features/<slug>.md"}`,
      "Run `brain progress add --summary \"...\"` to checkpoint this change",
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Check — deterministic brain-harness invariants (brainCheck in brain-data.js)
// ---------------------------------------------------------------------------

function cmdCheck(argv) {
  const spec = {
    "--strict": {
      value: false,
      desc: "also require a PASS verification doc for every shipped feature",
    },
  };
  const { flags } = parseArgs(argv, spec, "check");
  if (flags.help)
    helpBlock(
      "check",
      "Run deterministic brain-harness invariant checks (CI-usable: exit 1 on any failure)",
      spec,
      ["brain check", "brain check --strict"]
    );
  const brain = findBrain(flags.brain);
  // --strict is opt-in here because brains predating the invariant would go red
  // on upgrade (read-compat, rules/state.md). `brain ship` always enforces it.
  const checks = brainCheck(brain, { strict: !!flags.strict });
  // Evals are optional: evalChecks returns [] when the repo has no eval
  // suites, so a brain without AI work sees exactly the rows it saw before —
  // even one scaffolded by this version's `brain init` (which writes only
  // evals/index.md, never an empty suite).
  checks.push(...evalChecks(brain));

  const { config: verifyConfig, error: verifyError } = loadVerifyConfig(brain);
  if (!verifyError) {
    checks.push({
      check: "verify.json parses (when present)",
      status: "pass",
      detail: `${verifyConfig.checks.length} check(s) declared`,
    });
  } else if (verifyError.kind === "missing") {
    checks.push({ check: "verify.json parses (when present)", status: "pass", detail: "not present — optional" });
  } else {
    checks.push({ check: "verify.json parses (when present)", status: "fail", detail: verifyError.message });
  }

  const failed = checks.filter((c) => c.status === "fail");
  print([
    ...toonTable("checks", checks, ["check", "status", "detail"]),
    ...toonList(
      "help",
      failed.length
        ? [`${failed.length} check(s) failing — fix the detail(s) above, then re-run \`brain check\``]
        : ["All checks passing"]
    ),
  ]);
  if (failed.length) process.exit(1);
}

// ---------------------------------------------------------------------------
// Verify — declared project-check runner (.brain/verify.json registry)
// ---------------------------------------------------------------------------

// Last N lines of combined output, trimming a lone trailing empty line from
// the final newline so the tail doesn't end on a blank row.
function tailLines(text, n = 15) {
  const lines = (text || "").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-n);
}

// Sanitizes a check name into a safe TOON key suffix for `tail_<name>:` —
// check names are free-form strings, but TOON keys in this hand-rolled
// encoder aren't quoted, so anything outside [A-Za-z0-9_-] must be replaced.
function toonKeyPart(name) {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

// Runs one check via the shell, capturing combined stdout+stderr (redirected
// inside the shell command so ordering is preserved) and enforcing its
// timeout. Never throws — timeouts and non-zero exits are both reported as a
// structured result, not a JS exception.
function runVerifyCheck(check, cwd) {
  const timeoutSec = check.timeout || 300;
  const start = Date.now();
  const res = spawnSync(`${check.run} 2>&1`, { shell: true, cwd, timeout: timeoutSec * 1000, encoding: "utf8" });
  const seconds = Number(((Date.now() - start) / 1000).toFixed(1));
  const output = res.stdout || "";
  if (res.error && res.error.code === "ETIMEDOUT")
    return { check: check.name, status: "timeout", exit: null, seconds, output };
  const exit = res.status;
  return { check: check.name, status: exit === 0 ? "pass" : "fail", exit, seconds, output };
}

// Builds the TOON lines shared between stdout and the `--feature` run-note
// step, so the recorded evidence matches what the agent actually saw.
// ---------------------------------------------------------------------------
// Gate telemetry — .brain/runs/gates.jsonl
//
// Append-only, one row per gate execution. Mirrors the runs.jsonl summary-row
// convention already used by the evals subsystem so there is one shape to learn.
// Never throws: losing a metrics row must not fail a verify run.
// ---------------------------------------------------------------------------

function gatesLogPath(brain) {
  return path.join(brain, "runs", "gates.jsonl");
}

function recordGateRuns(brain, { stage, feature, results }) {
  try {
    const runsDir = path.join(brain, "runs");
    if (!fs.existsSync(runsDir)) return null;
    const at = new Date().toISOString();
    const repoRoot = path.dirname(path.resolve(brain));
    const branch = resolveBranch(brain, undefined);
    const commit = gitShortHead(repoRoot);
    const rows = results.map((r) =>
      JSON.stringify({
        at,
        stage,
        check: r.check,
        status: r.status,
        exit: r.exit,
        seconds: r.seconds,
        branch,
        commit,
        ...(feature ? { feature } : {}),
      })
    );
    fs.appendFileSync(gatesLogPath(brain), rows.join("\n") + "\n");
    return rows.length;
  } catch {
    return null;
  }
}

function readGateRows(brain) {
  const p = gatesLogPath(brain);
  if (!fs.existsSync(p)) return [];
  const rows = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // A corrupt row is not worth failing a report over — skip it.
    }
  }
  return rows;
}

function pct(n, d) {
  return d ? Number(((n / d) * 100).toFixed(1)) : null;
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[i];
}

// ---------------------------------------------------------------------------
// brain receipt — stamp provenance into a verification doc, by TOOL
//
// Receipts were hand-authored, which left two holes: the commit could name any
// ancestor (including one predating the feature entirely, so the verdict
// described code that never contained it), and `verified_by`/`commands` were
// free text nobody produced or checked. A hand-written receipt is a claim about
// provenance, not provenance.
//
// This writes the block from what the tool actually observed: HEAD at stamp
// time, plus the most recent gate results for that feature out of
// runs/gates.jsonl. It refuses when the tree is dirty, because a receipt naming
// HEAD while the working tree differs from HEAD is describing code that is not
// in any commit.
// ---------------------------------------------------------------------------

function cmdReceipt(argv) {
  const spec = {
    "--date": { value: true, desc: "verification doc date to stamp (default: the newest)" },
    "--verified-by": { value: true, desc: "who/what ran the verification (default: the caller)" },
    "--allow-dirty": {
      value: false,
      desc: "stamp even though the working tree differs from HEAD (records `dirty: true`)",
    },
  };
  const { flags, positionals } = parseArgs(argv, spec, "receipt");
  if (flags.help)
    helpBlock(
      "receipt",
      "Stamp a commit-bound provenance receipt into a feature's verification doc",
      spec,
      ["brain receipt authentication", 'brain receipt authentication --verified-by "feature-verifier"'],
      ["<feature> — feature slug from `brain features`"]
    );
  const slug = positionals[0];
  if (!slug) usageError("missing required argument <feature>", ["brain receipt <feature>"]);

  const brain = findBrain(flags.brain);
  const repoRoot = path.dirname(path.resolve(brain));
  if (!isGitRepo(repoRoot))
    opError("not a git repo — a receipt with no commit proves nothing", [
      "Run this inside a git repository, or omit the receipt and accept `provenance unverifiable`",
    ]);

  const docs = listVerifications(brain, slug);
  if (!docs.length)
    opError(`no verification doc for "${slug}"`, [
      "Run `brain playbook verify` and write the verdict doc first — a receipt annotates evidence, it does not create it",
    ]);
  const doc = flags.date ? docs.find((d) => d.date === flags.date) : docs[0];
  if (!doc)
    opError(`no verification doc dated ${flags.date} for "${slug}"`, [
      `known dates: ${docs.map((d) => d.date).join(", ")}`,
    ]);

  const dirty = gitWorktreeDirty(repoRoot);
  if (dirty && !flags["allow-dirty"])
    opError("working tree differs from HEAD — a receipt would name a commit that is not what was verified", [
      "Commit the change first, then re-run `brain receipt " + slug + "`",
      "Or pass --allow-dirty to record it explicitly as dirty (weaker evidence, honestly labelled)",
    ]);

  const commit = gitShortHead(repoRoot);
  const absDoc = path.resolve(brain, doc.file);
  let content;
  try {
    content = fs.readFileSync(absDoc, "utf8");
  } catch (e) {
    opError(`cannot read ${doc.file}: ${e.message}`, ["Check the file exists and is readable"]);
  }

  const { verdict } = parseVerdictDetail(content);
  if (verdict === "unknown")
    opError(`${doc.file} has no readable verdict — refusing to stamp provenance onto an unreadable claim`, [
      `Fix the verdict line first: ${VERDICT_ACCEPTED}`,
    ]);

  // Commands come from what `brain verify` actually ran for this feature, not
  // from a flag — that is the whole point.
  const rows = readGateRows(brain).filter((r) => r.feature === slug);
  const latestAt = rows.length ? rows[rows.length - 1].at : null;
  const observed = rows.filter((r) => r.at === latestAt);
  const commands = observed.length
    ? observed.map((r) => `${r.check} (exit ${r.exit === null ? "timeout" : r.exit})`).join("; ")
    : "";

  const verifiedBy = flags["verified-by"] || process.env.USER || "unknown";
  const block = [
    "<!-- brain:verification",
    `verdict: ${verdict}`,
    `commit: ${commit}`,
    `stamped_at: ${new Date().toISOString()}`,
    `verified_by: ${verifiedBy}`,
    ...(commands ? [`commands: ${commands}`] : []),
    ...(dirty ? ["dirty: true"] : []),
    "-->",
  ].join("\n");

  const existing = parseReceipt(content);
  const next = existing.present
    ? content.replace(/<!--\s*brain:verification[\s\S]*?-->/, block)
    : content.replace(/\s*$/, "\n\n" + block + "\n");
  writeFileAtomic(absDoc, next);

  print([
    "receipt:",
    kv("feature", slug, 2),
    kv("doc", doc.file, 2),
    kv("verdict", verdict, 2),
    kv("commit", commit, 2),
    kv("action", existing.present ? "replaced" : "added", 2),
    ...(commands ? [kv("commands", commands, 2)] : []),
    ...(dirty ? ["warning: recorded with dirty: true — the tree differed from HEAD"] : []),
    ...toonList("help", [
      commands
        ? "Run `brain check --strict` to confirm the receipt resolves to an ancestor of HEAD"
        : "No gate rows for this feature yet — run `brain verify --stage verify --feature " +
          slug +
          "` first so `commands` records what actually ran, then re-stamp",
    ]),
  ]);
}

function cmdMetrics(argv) {
  const spec = {
    "--limit": { value: true, desc: "only consider the most recent N gate rows" },
  };
  const { flags } = parseArgs(argv, spec, "metrics");
  if (flags.help)
    helpBlock(
      "metrics",
      "Gate effectiveness over .brain/runs/gates.jsonl — first-pass rate, which gate fails most, duration",
      spec,
      ["brain metrics", "brain metrics --limit 200"],
      []
    );
  const brain = findBrain(flags.brain);
  let rows = readGateRows(brain);
  if (flags.limit) {
    const n = parseInt(flags.limit, 10);
    if (!Number.isFinite(n) || n <= 0)
      usageError("--limit must be a positive integer", ["brain metrics --limit 200"]);
    rows = rows.slice(-n);
  }

  if (rows.length === 0) {
    print([
      "metrics: no gate runs recorded yet",
      ...toonList("help", [
        "Run `brain verify --stage baseline` — every check execution appends a row to runs/gates.jsonl",
        "Metrics answer whether the gates catch anything; a harness with none can only prove it is intact",
      ]),
    ]);
    return;
  }

  const total = rows.length;
  const passed = rows.filter((r) => r.status === "pass").length;

  // Group by (at, stage) — one `brain verify` invocation shares a timestamp, so
  // this is the unit a human means by "did it pass first try".
  const runs = new Map();
  for (const r of rows) {
    const key = `${r.at}|${r.stage}`;
    if (!runs.has(key)) runs.set(key, []);
    runs.get(key).push(r);
  }
  const runList = [...runs.values()];
  const cleanRuns = runList.filter((g) => g.every((r) => r.status === "pass")).length;

  const byCheck = new Map();
  for (const r of rows) {
    if (!byCheck.has(r.check)) byCheck.set(r.check, { check: r.check, runs: 0, failures: 0, secs: [] });
    const e = byCheck.get(r.check);
    e.runs++;
    if (r.status !== "pass") e.failures++;
    if (typeof r.seconds === "number") e.secs.push(r.seconds);
  }
  const perCheck = [...byCheck.values()]
    .map((e) => {
      const sorted = e.secs.slice().sort((a, b) => a - b);
      return {
        check: e.check,
        runs: e.runs,
        failures: e.failures,
        caught_pct: pct(e.failures, e.runs),
        p50_s: quantile(sorted, 0.5),
        p95_s: quantile(sorted, 0.95),
      };
    })
    // Most-failing first: the gates that never fail are the ones to question.
    .sort((a, b) => b.failures - a.failures || b.runs - a.runs);

  const neverFailed = perCheck.filter((c) => c.failures === 0 && c.runs >= 3);

  const lines = [
    "metrics:",
    kv("gate_executions", total, 2),
    kv("verify_runs", runList.length, 2),
    kv("first_pass_rate_pct", pct(cleanRuns, runList.length), 2),
    kv("gate_pass_rate_pct", pct(passed, total), 2),
    kv("window", `${rows[0].at} → ${rows[rows.length - 1].at}`, 2),
    ...toonTable("per_check", perCheck, ["check", "runs", "failures", "caught_pct", "p50_s", "p95_s"]),
  ];
  const help = [];
  if (neverFailed.length)
    help.push(
      `Never failed in ${neverFailed[0].runs}+ runs: ${neverFailed.map((c) => c.check).join(", ")} — confirm each CAN fail (a gate with no failing fixture is a claim, not a check)`
    );
  help.push("Run `brain verify --stage verify` to add rows");
  print([...lines, ...toonList("help", help)]);
}

function buildVerifyReportLines(results) {
  const lines = [
    ...toonTable(
      "results",
      results.map((r) => ({ check: r.check, status: r.status, exit: r.exit, seconds: r.seconds })),
      ["check", "status", "exit", "seconds"]
    ),
  ];
  for (const r of results) {
    if (r.status === "pass") continue;
    lines.push(`tail_${toonKeyPart(r.check)}: |`);
    for (const l of tailLines(r.output)) lines.push("  " + l);
  }
  return lines;
}

// `brain verify --stage evals` — run every eval suite through its declared
// runner and apply the gate. Suites run sequentially (they hit rate-limited
// APIs in real repos) and the table prints even when the gate fails, mirroring
// the registry runner's "report everything, then exit 1" contract.
function cmdVerifyEvals(brain, flags) {
  const names = listSuiteNames(brain);
  if (!names.length) {
    print([
      'results: 0 eval suites declared (stage "evals")',
      ...toonList("help", [
        `Create one at ${path.join(relBrain(brain), "evals/<suite>/")} with suite.json + cases.jsonl`,
        "Run `brain playbook ai` for the golden-set + eval-design standard",
      ]),
    ]);
    return;
  }

  let feat = null;
  if (flags.feature) {
    const list = loadFeatureList(brain);
    feat = list.features.find((f) => f.slug === flags.feature || f.id === flags.feature);
    if (!feat)
      usageError(`no feature "${flags.feature}"`, [`known slugs: ${list.features.map((f) => f.slug).join(", ")}`]);
  }

  const rows = [];
  const problems = [];
  for (const name of names) {
    const loaded = loadSuite(brain, name);
    if (loaded.error) {
      rows.push({ suite: name, result: "", score: "", gate: "error", detail: loaded.error });
      problems.push(name);
      continue;
    }
    const { suite, cases, runs } = loaded;
    const timeoutSec = suite.timeout || 600;
    const res = spawnSync(suite.runner, {
      shell: true,
      cwd: repoRoot(brain),
      timeout: timeoutSec * 1000,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.error && res.error.code === "ETIMEDOUT") {
      rows.push({ suite: name, result: "", score: "", gate: "error", detail: `runner timed out after ${timeoutSec}s` });
      problems.push(name);
      continue;
    }
    if (res.status !== 0) {
      // A signal kill or maxBuffer overflow leaves status null — name what
      // actually happened instead of printing "runner exited null".
      const how = res.status ?? `died (${res.signal || (res.error && res.error.code) || "unknown"})`;
      rows.push({
        suite: name,
        result: "",
        score: "",
        gate: "error",
        detail: `runner ${typeof how === "number" ? `exited ${how}` : how}: ${tailLines(res.stderr || res.stdout || "", 1).join(" ") || "(no output)"}`,
      });
      problems.push(name);
      continue;
    }
    const adapted = adaptRunOutput(res.stdout || "", suite.adapter);
    if (adapted.error) {
      rows.push({ suite: name, result: "", score: "", gate: "error", detail: adapted.error });
      problems.push(name);
      continue;
    }
    const { scored, unknown, summary } = scoreRun(cases, adapted.cases);
    const prev = lastRun(runs);
    const gate = gateVerdict(suite, summary, prev);
    recordRun(brain, name, {
      suite,
      scored,
      summary,
      usage: adapted.usage,
      ts: new Date().toISOString(),
      branch: resolveBranch(brain, undefined),
      commit: gitCommit(brain),
      unknown,
    });
    rows.push({
      suite: name,
      result: `${summary.pass}/${summary.total}`,
      score: formatScore(summary.score),
      gate: gate.status,
      detail: gate.reason,
    });
    if (gate.status === "fail") problems.push(name);
  }

  const lines = [
    ...toonTable("evals", rows, ["suite", "result", "score", "gate", "detail"]),
    kv("summary", `${rows.length - problems.length}/${rows.length} suite(s) clear`),
  ];
  const help = problems.length
    ? [
        `${problems.length} suite(s) blocking: ${problems.join(", ")}`,
        "Frozen regression cases are absolute — read them with `brain evals view <suite>`",
        "Run `brain playbook ai` section 5 for what to do with a failed gate",
      ]
    : ["All eval gates clear"];

  if (feat) {
    const { file, stepNumber } = appendRunStep(brain, feat.slug, {
      step: "verify --stage evals",
      observed: lines.join("\n"),
    });
    lines.push("run-note:", kv("file", file, 2), kv("step", stepNumber, 2));
  } else {
    help.push("Pass --feature <slug> to record these results as a run-note step");
  }

  print([...lines, ...toonList("help", help)]);
  if (problems.length) process.exit(1);
}

function cmdVerify(argv) {
  const spec = {
    "--stage": { value: true, desc: `stage to run (${ALL_VERIFY_STAGES.join("|")}, default: verify)` },
    "--only": { value: true, desc: "run just this one check by name — wins over --stage when both are passed" },
    "--feature": { value: true, desc: "also append the results verbatim as a run-note step for this feature" },
  };
  const { flags } = parseArgs(argv, spec, "verify");
  if (flags.help)
    helpBlock(
      "verify",
      "Run declared project checks from .brain/verify.json sequentially, from the repo root",
      spec,
      [
        "brain verify",
        "brain verify --stage baseline",
        "brain verify --stage evals",
        "brain verify --only typecheck",
        "brain verify --feature authentication",
      ]
    );

  const stage = flags.stage || "verify";
  if (flags.stage !== undefined && !ALL_VERIFY_STAGES.includes(stage))
    usageError(`invalid --stage "${stage}"`, [`valid stages: ${ALL_VERIFY_STAGES.join(", ")}`]);

  const brain = findBrain(flags.brain);

  // The evals stage is a different animal from the verify.json registry: it
  // runs eval SUITES and applies the regression gate. It is opt-in by design
  // (plan `ai-work-harness`, round-1 answer) — model calls cost money, so they
  // never ride along on an ordinary `brain verify`.
  if (stage === "evals" && !flags.only) return cmdVerifyEvals(brain, flags);

  let feat = null;
  if (flags.feature) {
    const list = loadFeatureList(brain);
    feat = list.features.find((f) => f.slug === flags.feature || f.id === flags.feature);
    if (!feat)
      usageError(`no feature "${flags.feature}"`, [`known slugs: ${list.features.map((f) => f.slug).join(", ")}`]);
  }

  const { config, error } = loadVerifyConfig(brain);
  if (error) {
    if (error.kind === "missing") {
      opError(error.message, [
        `Create ${path.relative(process.cwd(), verifyConfigPath(brain))} with a checks array, e.g. ${VERIFY_SNIPPET}`,
        `Each check: name (unique), run (shell command), stages (subset of ${VERIFY_STAGES.join("|")}), optional timeout (seconds, default 300)`,
      ]);
    }
    opError(error.message, [`Fix ${path.relative(process.cwd(), verifyConfigPath(brain))} and re-run \`brain verify\``]);
  }

  let selected;
  if (flags.only) {
    const found = config.checks.find((c) => c.name === flags.only);
    if (!found)
      usageError(`unknown check "${flags.only}"`, [
        `valid checks: ${config.checks.map((c) => c.name).join(", ")}`,
      ]);
    selected = [found];
  } else {
    selected = config.checks.filter((c) => c.stages.includes(stage));
  }

  if (selected.length === 0) {
    const perStage = VERIFY_STAGES.map(
      (s) => `${s}: ${config.checks.filter((c) => c.stages.includes(s)).length}`
    ).join(", ");
    print([
      `results: 0 checks match stage "${stage}"`,
      ...toonList("help", [
        `Checks per stage — ${perStage}`,
        "Run `brain verify --stage <stage>` with a stage that has checks, or `brain verify --only <name>`",
      ]),
    ]);
    return;
  }

  const repoRoot = path.dirname(brain);
  const results = selected.map((check) => runVerifyCheck(check, repoRoot));
  const failing = results.filter((r) => r.status !== "pass");

  // Persist one row per gate execution. Everything needed already existed and
  // was thrown away: without it nobody can answer "do these gates catch
  // anything, and how often do we pass first try?" — which is the difference
  // between a harness that is intact and one that is working.
  recordGateRuns(brain, {
    stage: flags.only ? `only:${flags.only}` : stage,
    feature: feat ? feat.slug : null,
    results,
  });

  const reportLines = buildVerifyReportLines(results);
  const lines = [...reportLines];
  lines.push(kv("summary", `${results.length - failing.length}/${results.length} pass`));

  const help = [];
  if (failing.length) {
    for (const r of failing) help.push(`Run \`brain verify --only ${r.check}\` to re-run just that check`);
  } else {
    help.push("All checks passing");
  }

  if (feat) {
    const stepLabel = flags.only ? `verify --only ${flags.only}` : `verify --stage ${stage}`;
    const { file, stepNumber } = appendRunStep(brain, feat.slug, {
      step: stepLabel,
      observed: reportLines.join("\n"),
    });
    lines.push("run-note:", kv("file", file, 2), kv("step", stepNumber, 2));
    help.push(`Run \`brain watch ${feat.slug}\` to see the recorded run-note step in the execution dashboard`);
  } else {
    help.push("Pass --feature <slug> to record these results as a run-note step");
  }

  lines.push(...toonList("help", help));
  print(lines);
  if (failing.length) process.exit(1);
}

// ---------------------------------------------------------------------------
// Ship — strict, honest flip to shipped (Addendum v6, v6.4/D4)
// ---------------------------------------------------------------------------

function cmdShip(argv) {
  const spec = {
    "--evidence": { value: true, desc: "evidence string proving the feature works (required)" },
  };
  const { flags, positionals } = parseArgs(argv, spec, "ship");
  if (flags.help)
    helpBlock(
      "ship",
      "Flip a feature to shipped: evidence required, screenshot check, checkpoint, then `brain check`",
      spec,
      ['brain ship authentication --evidence "verified 2026-07-14, golden+error path PASS"'],
      ["<slug> — feature slug from `brain features`"]
    );
  const slug = positionals[0];
  if (!slug) usageError("missing required argument <slug>", ['brain ship <slug> --evidence "..."']);
  if (!flags.evidence || !flags.evidence.trim())
    usageError("--evidence is required", [`brain ship ${slug} --evidence "..."`]);

  const brain = findBrain(flags.brain);
  const list = loadFeatureList(brain);
  const feat = list.features.find((f) => f.slug === slug || f.id === slug);
  if (!feat) opError(`no feature "${slug}"`, [`known slugs: ${list.features.map((f) => f.slug).join(", ")}`]);

  if (feat.status === "shipped") {
    print([
      `feature: ${feat.slug} already shipped (no-op)`,
      ...toonList("help", [`Run \`brain features view ${feat.slug}\` to see the recorded evidence`]),
    ]);
    return;
  }

  const previous = feat.status;

  // PREFLIGHT, then commit. Project the next state in memory and validate it
  // BEFORE any write, so a failing check leaves the brain exactly as it was.
  // This replaces the previous order (write feature_list.json, append the
  // checkpoint, then run brainCheck and exit 1 with the flip already on disk) —
  // that behavior was specified, not accidental, and reporting the failure
  // honestly did not undo the fact that later reads saw a feature marked
  // shipped on a brain that never passed its checks.
  const projected = {
    ...list,
    features: list.features.map((f) =>
      f === feat ? { ...f, status: "shipped", evidence: flags.evidence } : f
    ),
  };

  // strict: a ship without a PASS verification is exactly the premature "done"
  // this harness exists to prevent.
  const checks = brainCheck(brain, { list: projected, strict: true, strictScope: feat.slug });
  const failed = checks.filter((c) => c.status === "fail");
  if (failed.length) {
    print([
      `ship: refused — ${failed.length} harness check(s) would fail`,
      kv("slug", feat.slug, 2),
      kv("status", `${previous} (unchanged — nothing was written)`, 2),
      ...toonTable("checks", checks, ["check", "status", "detail"]),
      ...toonList("help", [
        `Fix the failing detail(s) above, then re-run \`brain ship ${feat.slug} --evidence "..."\``,
        "Run `brain check` to re-verify without attempting the ship",
      ]),
    ]);
    process.exit(1);
    return;
  }

  feat.status = "shipped";
  feat.evidence = flags.evidence;

  // Shipping touches TWO files (feature_list.json + runs/progress.md). Each
  // write is atomic on its own, but the pair was not: a failure on the second
  // left a feature marked shipped with no checkpoint recording it. Snapshot the
  // first file's bytes and restore them if the second throws, so the pair is
  // all-or-nothing.
  const flPath = featureListPath(brain);
  const flBefore = fs.existsSync(flPath) ? fs.readFileSync(flPath) : null;
  saveFeatureList(brain, list);

  const lines = ["ship:", kv("slug", feat.slug, 2), kv("previous", previous, 2), kv("status", "shipped", 2)];

  const shots = listShots(brain, feat.slug);
  if (shots.length === 0) lines.push(`warning: ${feat.slug} has zero screenshots — evidence is unverified visually`);

  const evidenceCapped = flags.evidence.length > 120 ? flags.evidence.slice(0, 120) : flags.evidence;
  let checkpointResult;
  try {
    checkpointResult = appendProgressEntry(brain, { summary: `shipped ${feat.slug}: ${evidenceCapped}` });
  } catch (e) {
    if (flBefore !== null) writeFileAtomic(flPath, flBefore);
    opError(`checkpoint failed, ship rolled back: ${e.message}`, [
      `${feat.slug} is still "${previous}" — feature_list.json was restored`,
      `Fix runs/progress.md, then re-run \`brain ship ${feat.slug} --evidence "..."\``,
    ]);
  }
  // A MISSING progress.md is not a write failure — appendProgressEntry returns
  // null by design so a brain without a cursor still ships. Warn, don't roll back.
  if (checkpointResult) lines.push(kv("checkpoint", `shipped ${feat.slug}: ${evidenceCapped}`, 2));
  else lines.push("warning: runs/progress.md not found — checkpoint not recorded");

  // Regenerate the derived index so the tracker and its human-facing mirror are
  // never out of step even for a moment. The drift check is skipped during
  // preflight (the index describes disk, not a projection), so this is where the
  // two are reconciled.
  const regen = regenerateFeaturesIndex(brain);
  if (regen === "written") lines.push(kv("index", "features/index.md regenerated", 2));
  else if (regen === "no-markers")
    lines.push("warning: features/index.md has no brain:features-table markers — update it by hand or `brain check` will report drift");
  else if (regen === "missing")
    lines.push("warning: features/index.md absent — run `brain features index --write --create`");

  // Re-verify AFTER the write. Preflight validated a projection; only this can
  // assert the invariant the ship actually left behind, and it is what makes
  // "no drift left behind" a checked claim rather than a comment.
  const post = brainCheck(brain).filter((c) => c.status === "fail");
  if (post.length) {
    lines.push(...toonTable("post_ship_checks", post, ["check", "status", "detail"]));
    lines.push(
      ...toonList("help", [
        `${feat.slug} shipped, but ${post.length} check(s) fail AFTER the write — fix the detail(s) above`,
      ])
    );
    print(lines);
    process.exit(1);
    return;
  }

  lines.push(
    ...toonList("help", [
      `Run \`brain features view ${feat.slug}\` to confirm`,
      "Run `brain check` anytime to re-verify harness invariants",
    ])
  );
  print(lines);
}

// ---------------------------------------------------------------------------
// Execution dashboard verbs (Addendum v8 — /watch surface)
// ---------------------------------------------------------------------------

function cmdWatch(argv) {
  const spec = {
    "--no-open": { value: false, desc: "do not open the system browser" },
    "--port": { value: true, desc: `review server port (default: ${REVIEW_DEFAULT_PORT} or BRAIN_AXI_PORT)` },
  };
  const { flags, positionals } = parseArgs(argv, spec, "watch");
  if (flags.help)
    helpBlock(
      "watch",
      "Open the live execution dashboard for a feature (progress, run-step logs, verifications, PR state)",
      spec,
      ["brain watch authentication", "brain watch authentication --no-open"],
      ["<feature> — feature slug from `brain features`"]
    );
  const arg = positionals[0];
  if (!arg) usageError("missing required argument <feature>", ["brain watch <feature>"]);

  const brain = findBrain(flags.brain);
  const list = loadFeatureList(brain);
  const feat = list.features.find((f) => f.slug === arg || f.id === arg);
  if (!feat) opError(`no feature "${arg}"`, [`known slugs: ${list.features.map((f) => f.slug).join(", ")}`]);

  return watchAsync(brain, feat, flags);
}

async function watchAsync(brain, feat, flags) {
  const port = resolveReviewPort(flags);
  await ensureReviewServer(port);
  const url = `http://127.0.0.1:${port}/watch/${encodeURIComponent(feat.slug)}?brain=${encodeURIComponent(brain)}`;

  print([
    "watch:",
    kv("feature", feat.slug, 2),
    kv("status", feat.status, 2),
    kv("url", url, 2),
    ...toonList("help", [
      ...(flags["no-open"] ? [`Open ${url} in a browser — it live-updates as brain state changes`] : []),
      `Run \`brain pr ${feat.slug} --url <pr-url>\` once a PR is opened to record the dashboard's terminal state`,
      `Run \`brain runs append ${feat.slug} --step "..." --observed "..."\` per step — the dashboard picks each one up live`,
    ]),
  ]);

  if (!flags["no-open"]) {
    try {
      const opener = process.platform === "darwin" ? "open" : "xdg-open";
      const child = spawn(opener, [url], { detached: true, stdio: "ignore" });
      child.on("error", () => {}); // never fail the command if the browser can't be opened
      child.unref();
    } catch {
      // opening the browser is best-effort
    }
  }
}

function cmdPr(argv) {
  const spec = {
    "--url": { value: true, desc: "the opened pull request's URL (required)" },
  };
  const { flags, positionals } = parseArgs(argv, spec, "pr");
  if (flags.help)
    helpBlock(
      "pr",
      "Record the feature's opened pull request — the execution dashboard's terminal state",
      spec,
      ['brain pr authentication --url "https://github.com/org/repo/pull/42"'],
      ["<slug> — feature slug from `brain features`"]
    );
  const slug = positionals[0];
  if (!slug) usageError("missing required argument <slug>", ['brain pr <slug> --url "https://..."']);
  if (!flags.url || !flags.url.trim())
    usageError("--url is required", [`brain pr ${slug} --url "https://github.com/org/repo/pull/42"`]);
  const url = flags.url.trim();
  if (!/^https?:\/\//.test(url))
    usageError(`invalid --url "${flags.url}"`, ["--url takes the PR's http(s) URL, e.g. https://github.com/org/repo/pull/42"]);

  const brain = findBrain(flags.brain);
  const list = loadFeatureList(brain);
  const feat = list.features.find((f) => f.slug === slug || f.id === slug);
  if (!feat) opError(`no feature "${slug}"`, [`known slugs: ${list.features.map((f) => f.slug).join(", ")}`]);

  const { file } = recordPr(brain, feat.slug, url);

  const lines = ["pr:", kv("feature", feat.slug, 2), kv("url", url, 2), kv("file", file, 2)];

  const urlCapped = url.length > 120 ? url.slice(0, 120) : url;
  const checkpointResult = appendProgressEntry(brain, { summary: `PR opened for ${feat.slug}: ${urlCapped}` });
  if (checkpointResult) lines.push(kv("checkpoint", `PR opened for ${feat.slug}: ${urlCapped}`, 2));
  else lines.push("warning: runs/progress.md not found — checkpoint not recorded");

  const help = [`Run \`brain watch ${feat.slug}\` — the dashboard now shows the PR-opened terminal state`];
  if (feat.status !== "shipped") help.push(`Run \`brain ship ${feat.slug} --evidence "..."\` once the feature is demonstrably working`);
  lines.push(...toonList("help", help));
  print(lines);
}

function cmdProgress(argv) {
  const sub = argv[0] && !argv[0].startsWith("--") ? argv[0] : "show";
  const rest = sub === argv[0] ? argv.slice(1) : argv;
  if (sub === "show") return cmdProgressShow(rest);
  if (sub === "add") return cmdProgressAdd(rest);
  usageError(`unknown subcommand \`progress ${sub}\``, [
    "valid subcommands: show (default), add --summary \"...\"",
  ]);
}

function cmdProgressShow(argv) {
  const spec = { "--limit": { value: true, desc: "older entries to list (default: 10)" } };
  const { flags } = parseArgs(argv, spec, "progress");
  if (flags.help)
    helpBlock("progress", "Latest session checkpoint in full + older entry index", spec,
      ["brain progress", "brain progress --limit 3", "brain progress add --summary \"...\""]);
  const brain = findBrain(flags.brain);
  const progress = parseProgress(brain);
  if (!progress.entries.length) {
    print([
      "progress: 0 checkpoints recorded in this brain",
      ...toonList("help", ["Run `brain progress add --summary \"...\"` to record the first checkpoint"]),
    ]);
    return;
  }
  const [latest, ...older] = progress.entries;
  const limit = flags.limit ? parseInt(flags.limit, 10) : 10;
  if (!Number.isInteger(limit) || limit < 0)
    usageError(`invalid --limit "${flags.limit}"`, ["--limit takes a non-negative integer"]);

  const lines = [
    kv("count", `${progress.entries.length} checkpoints total`),
    "latest: |",
    ...latest.body.split("\n").map((l) => "  " + l),
  ];
  const shown = older.slice(0, limit);
  if (shown.length) lines.push(...toonTable("older", shown, ["date", "summary"]));
  const help = [];
  if (older.length > shown.length)
    help.push(`Run \`brain progress --limit ${older.length}\` for all ${older.length} older entries`);
  help.push("Run `brain progress add --summary \"...\" --next \"...\"` to append a checkpoint");
  lines.push(...toonList("help", help));
  print(lines);
}

function resolveBranch(brain, explicit) {
  if (explicit) return explicit;
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: path.dirname(brain),
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
  } catch {
    return "unknown";
  }
}

// Shared by `progress add` and `brain ship`'s internal checkpoint. Returns
// {date, branch, file} on success, or null when runs/progress.md is missing
// (callers decide whether that's fatal for them).
function appendProgressEntry(brain, { summary, branch, feature, runNote, next, evalLine } = {}) {
  const progress = parseProgress(brain);
  if (progress.raw === null) return null;

  const resolvedBranch = resolveBranch(brain, branch);
  const date = new Date().toISOString().slice(0, 10);
  const entry = [
    `## ${date} — ${summary}`,
    `- branch: \`${resolvedBranch}\``,
    `- in-progress feature: ${feature || "none"}`,
    `- run note: ${runNote || "none"}`,
    ...(evalLine ? [`- eval: ${evalLine}`] : []),
    ...(next ? [`- next: ${next}`] : []),
  ].join("\n");

  const sep = progress.raw.match(/\n---+\n/);
  let updated;
  if (sep) {
    const idx = sep.index + sep[0].length;
    updated = progress.raw.slice(0, idx) + "\n" + entry + "\n\n---\n" + progress.raw.slice(idx);
  } else {
    updated = progress.raw.trimEnd() + "\n\n---\n\n" + entry + "\n";
  }
  // Atomic: this is a read-modify-rewrite of the WHOLE progress file, so a
  // crash mid-write would truncate the entire session cursor.
  writeFileAtomic(progress.path, updated);
  return { date, branch: resolvedBranch, file: progress.path };
}

function cmdProgressAdd(argv) {
  const spec = {
    "--summary": { value: true, desc: "one-line checkpoint summary (required)" },
    "--branch": { value: true, desc: "current branch (default: from git)" },
    "--feature": { value: true, desc: "in-progress feature id/slug (default: none)" },
    "--run-note": { value: true, desc: "path to the run note (default: none)" },
    "--eval": { value: true, desc: "eval suite whose real last-run score + delta to stamp on this checkpoint" },
    "--next": { value: true, desc: "one sentence on what to do next" },
  };
  const { flags } = parseArgs(argv, spec, "progress add");
  if (flags.help)
    helpBlock("progress add", "Append a checkpoint entry to the top of runs/progress.md", spec, [
      'brain progress add --summary "auth refactor half-done" --next "wire session into loader"',
      'brain progress add --eval summarizer --summary "added 2 refusal examples"',
    ]);
  if (!flags.summary)
    usageError("--summary is required", ['brain progress add --summary "..." [--branch ...] [--next ...]']);

  const brain = findBrain(flags.brain);

  // --eval reads the number out of the suite's own run record rather than
  // taking it from the caller: a checkpoint claiming a score nobody ran is the
  // exact failure the evals subsystem exists to prevent.
  let evalLine;
  if (flags.eval) {
    const { suite, runs, error } = loadSuite(brain, flags.eval);
    if (error) opError(error, [`known suites: ${listSuiteNames(brain).join(", ") || "(none)"}`]);
    const run = lastRun(runs);
    if (!run)
      opError(`suite "${suite.name}" has no recorded run to cite`, [
        `Run \`brain evals run ${suite.name}\` first — a checkpoint cannot cite a score that was never measured`,
      ]);
    const score = runScore(run);
    const prevScore = runScore(runs.length > 1 ? runs[runs.length - 2] : null);
    // "baseline" means no prior run exists — a missing CURRENT score is not a
    // baseline, it is an unknown, and the checkpoint must say so.
    const delta =
      score === null
        ? "(unknown)"
        : prevScore === null || prevScore === undefined
          ? "baseline"
          : `${score >= prevScore ? "+" : ""}${(score - prevScore).toFixed(3)}`;
    const frozen = (run.frozen_failing || []).length;
    evalLine = [
      `${suite.name} ${formatScore(score) || "(unknown)"} (${delta})`,
      `${run.pass ?? "?"}/${run.total ?? "?"} pass`,
      frozen ? `${frozen} frozen case(s) FAILING` : "no frozen failures",
      ...(run.usage && run.usage.cost_usd !== undefined ? [`cost ${run.usage.cost_usd}`] : []),
      `run ${run.ts}`,
    ].join(", ");
  }

  const result = appendProgressEntry(brain, {
    summary: flags.summary,
    branch: flags.branch,
    feature: flags.feature,
    runNote: flags["run-note"],
    next: flags.next,
    evalLine,
  });
  if (!result)
    opError("runs/progress.md not found in this brain", ["Create runs/progress.md first (see HARNESS.md state layer)"]);

  print([
    "checkpoint:",
    kv("date", result.date, 2),
    kv("summary", flags.summary, 2),
    kv("branch", result.branch, 2),
    ...(evalLine ? [kv("eval", evalLine, 2)] : []),
    kv("file", path.relative(process.cwd(), result.file), 2),
  ]);
}

function cmdRuns(argv) {
  const sub = argv[0] && !argv[0].startsWith("--") ? argv[0] : "list";
  const rest = sub === argv[0] ? argv.slice(1) : argv;

  if (sub === "list") {
    const { flags } = parseArgs(rest, {}, "runs");
    if (flags.help)
      helpBlock("runs", "List per-task run notes (deep task state)", {},
        ["brain runs", "brain runs view 2026-07-10-preview-deployments"]);
    const brain = findBrain(flags.brain);
    const notes = listMd(path.join(brain, "runs")).filter((n) => n.name !== "progress");
    if (!notes.length) {
      print(["runs: 0 run notes in this brain", ...toonList("help", ["Run notes live at runs/<YYYY-MM-DD>-<slug>.md"])]);
      return;
    }
    const rows = notes.map((n) => ({ name: n.name, title: firstHeading(n.file) }));
    print([
      ...toonTable("runs", rows, ["name", "title"]),
      ...toonList("help", ["Run `brain runs view <name>` for the full run note"]),
    ]);
    return;
  }
  if (sub === "view") {
    const spec = { "--full": { value: false, desc: "print the complete run note" } };
    const { flags, positionals } = parseArgs(rest, spec, "runs view");
    if (flags.help)
      helpBlock("runs view", "Show one run note", spec,
        ["brain runs view 2026-07-10-preview-deployments --full"], ["<name> — run note name from `brain runs`"]);
    const name = positionals[0];
    if (!name) usageError("missing required argument <name>", ["brain runs view <name>  (see `brain runs`)"]);
    const brain = findBrain(flags.brain);
    const file = path.join(brain, "runs", name.replace(/\.md$/, "") + ".md");
    if (!fs.existsSync(file)) {
      const known = listMd(path.join(brain, "runs")).filter((n) => n.name !== "progress").map((n) => n.name);
      opError(`no run note "${name}"`, [`known run notes: ${known.join(", ") || "(none)"}`]);
    }
    print([
      "run:",
      kv("name", name, 2),
      kv("title", firstHeading(file), 2),
      ...bodyLines("body", fs.readFileSync(file, "utf8").trim(), {
        full: !!flags.full,
        fullCommand: `brain runs view ${name} --full`,
      }),
    ]);
    return;
  }
  if (sub === "append") return cmdRunsAppend(rest);
  usageError(`unknown subcommand \`runs ${sub}\``, ["valid subcommands: list (default), view <name>, append <feature>"]);
}

function cmdRunsAppend(argv) {
  const spec = {
    "--step": { value: true, desc: "step name/title (required)" },
    "--observed": { value: true, desc: "verbatim observed output for this step (required)" },
    "--note": { value: true, desc: "run note filename, no extension (default: YYYY-MM-DD-progress)" },
  };
  const { flags, positionals } = parseArgs(argv, spec, "runs append");
  if (flags.help)
    helpBlock(
      "runs append",
      "Append a verbatim step to a feature's run note (deep execution state, not the rolling progress.md cursor)",
      spec,
      ['brain runs append authentication --step "ran playwright golden path" --observed "$(cat out.txt)"'],
      ["<feature> — feature slug"]
    );
  const feature = positionals[0];
  if (!feature)
    usageError("missing required argument <feature>", ['brain runs append <feature> --step "..." --observed "..."']);
  if (!flags.step) usageError("--step is required", [`brain runs append ${feature} --step "..." --observed "..."`]);
  if (!flags.observed)
    usageError("--observed is required", [`brain runs append ${feature} --step "${flags.step}" --observed "..."`]);

  const brain = findBrain(flags.brain);
  const list = loadFeatureList(brain);
  const feat = list.features.find((f) => f.slug === feature || f.id === feature);
  if (!feat) opError(`no feature "${feature}"`, [`known slugs: ${list.features.map((f) => f.slug).join(", ")}`]);

  const { file, stepNumber } = appendRunStep(brain, feat.slug, {
    note: flags.note,
    step: flags.step,
    observed: flags.observed,
  });
  print([
    "run-step:",
    kv("file", file, 2),
    kv("step", stepNumber, 2),
    ...toonList("help", [
      `If this step produced a visual test, run \`brain shots add <img> --feature ${feat.slug} --step <NN-name>\` (pass or fail)`,
      `Run \`brain ship ${feat.slug} --evidence "..."\` once the feature is demonstrably working`,
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Evals — AI suites, golden sets, run history (.brain/evals/, lib/review/evals.js)
// ---------------------------------------------------------------------------

// Shortens a case's input for a table cell. Cases carry whole prompts and
// documents; a list view that dumps them is unreadable and expensive.
function evalPreview(value, limit = 60) {
  const s = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : flat.slice(0, limit - 1) + "…";
}

function requireSuite(brain, name) {
  if (!name)
    usageError("missing required argument <suite>", ["brain evals view <suite>  (see `brain evals`)"]);
  const loaded = loadSuite(brain, name);
  if (loaded.error)
    opError(loaded.error, [`known suites: ${listSuiteNames(brain).join(", ") || "(none)"}`]);
  return loaded;
}

function cmdEvals(argv) {
  const sub = argv[0] && !argv[0].startsWith("--") ? argv[0] : "list";
  const rest = sub === argv[0] ? argv.slice(1) : argv;

  if (sub === "list") {
    const { flags } = parseArgs(rest, {}, "evals");
    if (flags.help)
      helpBlock("evals", "List eval suites: cases, last run, score, and state (never-run|stale|regressed|ok)", {}, [
        "brain evals",
        "brain evals view <suite>",
      ]);
    const brain = findBrain(flags.brain);
    const rows = suiteRows(brain);
    if (!rows.length) {
      print([
        "evals: 0 suites in this brain",
        ...toonList("help", [
          `Create one at ${path.join(relBrain(brain), "evals/<suite>/")} with suite.json + cases.jsonl`,
          `suite.json shape: ${SUITE_SNIPPET}`,
          "Run `brain playbook ai` for the golden-set + eval-design standard",
        ]),
      ]);
      return;
    }
    const attention = rows.filter((r) => r.state !== "ok");
    print([
      ...toonTable("suites", rows, ["suite", "kind", "cases", "frozen", "last_run", "score", "state"]),
      ...toonList("help", [
        ...(attention.length
          ? [`${attention.length} suite(s) need attention: ${attention.map((r) => `${r.suite} (${r.state})`).join(", ")}`]
          : []),
        "Run `brain evals view <suite>` for thresholds, the last run, and failing cases",
        "Run `brain evals cases <suite>` to read the golden set",
      ]),
    ]);
    return;
  }

  if (sub === "view") {
    const { flags, positionals } = parseArgs(rest, {}, "evals view");
    if (flags.help)
      helpBlock("evals view", "Show one suite: config, coverage, last run, failing cases", {},
        ["brain evals view skill-coverage"], ["<suite> — suite name from `brain evals`"]);
    const brain = findBrain(flags.brain);
    const name = positionals[0];
    const { suite, cases, runs, errors } = requireSuite(brain, name);
    const run = lastRun(runs);
    const prev = runs.length > 1 ? runs[runs.length - 2] : null;
    const score = runScore(run);
    const prevScore = runScore(prev);
    const byOrigin = {};
    const byTag = {};
    for (const c of cases) {
      byOrigin[c.origin] = (byOrigin[c.origin] || 0) + 1;
      for (const t of c.tags || []) byTag[t] = (byTag[t] || 0) + 1;
    }
    const thresholds = suite.thresholds || {};
    const lines = [
      "suite:",
      kv("name", suite.name, 2),
      kv("kind", suite.kind, 2),
      kv("runner", suite.runner, 2),
      kv("adapter", suite.adapter, 2),
      ...(suite.model ? [kv("model", suite.model, 2)] : []),
      ...(suite.description ? [kv("description", suite.description, 2)] : []),
      kv("cases", `${cases.length} total, ${cases.filter((c) => c.frozen).length} frozen`, 2),
      kv("origins", Object.entries(byOrigin).map(([k, v]) => `${v} ${k}`).join(", ") || "(none)", 2),
      kv("tags", Object.entries(byTag).map(([k, v]) => `${k}:${v}`).join(", ") || "(none)", 2),
      kv(
        "thresholds",
        Object.keys(thresholds).length ? Object.entries(thresholds).map(([k, v]) => `${k}=${v}`).join(", ") : "(none declared)",
        2
      ),
      kv("stale", run ? String(isStale(brain, suite, run)) : "n/a (never run)", 2),
    ];
    if (suite.prompts && suite.prompts.length) {
      lines.push(
        ...toonTable(
          "prompts",
          suite.prompts.map((p) => ({
            name: p.name || path.basename(p.path),
            path: p.path,
            resolves: fs.existsSync(path.resolve(repoRoot(brain), p.path)) ? "yes" : "NO",
          })),
          ["name", "path", "resolves"]
        )
      );
    }
    if (run) {
      lines.push(
        "last_run:",
        kv("ts", run.ts, 2),
        ...(run.branch ? [kv("branch", run.branch, 2)] : []),
        ...(run.commit ? [kv("commit", run.commit, 2)] : []),
        kv("result", `${run.pass ?? "?"}/${run.total ?? "?"} pass`, 2),
        kv("score", formatScore(score) || "(unknown)", 2),
        kv(
          "delta",
          prevScore === null || score === null ? "(no prior run)" : `${score >= prevScore ? "+" : ""}${(score - prevScore).toFixed(3)}`,
          2
        ),
        ...(run.usage ? [kv("usage", Object.entries(run.usage).map(([k, v]) => `${k}=${v}`).join(", "), 2)] : []),
        ...(run.failing && run.failing.length ? [kv("failing", run.failing.join(", "), 2)] : []),
        ...(run.partial ? [kv("partial", "true — some cases were not scored", 2)] : [])
      );
    } else {
      lines.push(kv("last_run", "(never run)"));
    }
    if (errors.length) lines.push(...toonList("data_errors", errors));
    print([
      ...lines,
      ...toonList("help", [
        `Run \`brain evals cases ${suite.name}\` to read the golden set`,
        `Run \`brain evals runs ${suite.name}\` for run history`,
        "Run `brain playbook ai` for the change loop (baseline, one change, re-run, compare per-case)",
      ]),
    ]);
    return;
  }

  if (sub === "cases") {
    const spec = {
      "--frozen": { value: false, desc: "only frozen regression cases" },
      "--origin": { value: true, desc: `filter by origin (${CASE_ORIGINS.join("|")})` },
      "--tag": { value: true, desc: "filter by tag" },
      "--limit": { value: true, desc: "max rows (default: 100)" },
    };
    const { flags, positionals } = parseArgs(rest, spec, "evals cases");
    if (flags.help)
      helpBlock("evals cases", "List a suite's golden set", spec,
        ["brain evals cases skill-coverage", "brain evals cases skill-coverage --frozen"],
        ["<suite> — suite name from `brain evals`"]);
    const brain = findBrain(flags.brain);
    const name = positionals[0];
    const { cases } = requireSuite(brain, name);
    let rows = cases;
    if (flags.frozen) rows = rows.filter((c) => c.frozen);
    if (flags.origin) rows = rows.filter((c) => c.origin === flags.origin);
    if (flags.tag) rows = rows.filter((c) => (c.tags || []).includes(flags.tag));
    const limit = flags.limit ? Number(flags.limit) : 100;
    if (!Number.isFinite(limit) || limit <= 0) usageError("--limit must be a positive number", ["brain evals cases <suite> --limit 20"]);
    const shown = rows.slice(0, limit);
    print([
      ...toonTable(
        "cases",
        shown.map((c) => ({
          id: c.id,
          origin: c.origin,
          frozen: c.frozen ? "yes" : "",
          tags: (c.tags || []).join("|"),
          input: evalPreview(c.input),
          expected: evalPreview(c.expected),
        })),
        ["id", "origin", "frozen", "tags", "input", "expected"]
      ),
      kv("shown", `${shown.length} of ${cases.length} case(s)`),
      ...toonList("help", [
        "Every bug you fix becomes a frozen regression case — `brain playbook ai` section 3",
        `Run \`brain evals view ${name}\` for thresholds and the last run`,
      ]),
    ]);
    return;
  }

  if (sub === "runs") {
    const spec = { "--limit": { value: true, desc: "max rows, newest first (default: 20)" } };
    const { flags, positionals } = parseArgs(rest, spec, "evals runs");
    if (flags.help)
      helpBlock("evals runs", "Run history for one suite, newest first", spec,
        ["brain evals runs skill-coverage --limit 5"], ["<suite> — suite name from `brain evals`"]);
    const brain = findBrain(flags.brain);
    const name = positionals[0];
    const { runs } = requireSuite(brain, name);
    const limit = flags.limit ? Number(flags.limit) : 20;
    if (!Number.isFinite(limit) || limit <= 0) usageError("--limit must be a positive number", ["brain evals runs <suite> --limit 5"]);
    if (!runs.length) {
      print([
        `runs: 0 recorded runs for ${name}`,
        ...toonList("help", ["A suite with no baseline cannot tell an improvement from a regression — record one before editing prompts"]),
      ]);
      return;
    }
    const rows = runs
      .slice()
      .reverse()
      .slice(0, limit)
      .map((r) => ({
        ts: r.ts,
        result: `${r.pass ?? "?"}/${r.total ?? "?"}`,
        score: formatScore(runScore(r)),
        branch: r.branch || "",
        cost: r.usage && r.usage.cost_usd !== undefined ? String(r.usage.cost_usd) : "",
        partial: r.partial ? "yes" : "",
      }));
    print([
      ...toonTable("runs", rows, ["ts", "result", "score", "branch", "cost", "partial"]),
      kv("shown", `${rows.length} of ${runs.length} run(s)`),
      ...toonList("help", [`Run \`brain evals view ${name}\` for the latest run in full`]),
    ]);
    return;
  }

  if (sub === "run") return cmdEvalsRun(rest);
  if (sub === "record") return cmdEvalsRecord(rest);
  if (sub === "golden") return cmdEvalsGolden(rest);

  usageError(`unknown subcommand \`evals ${sub}\``, [
    "valid subcommands: list (default), view <suite>, cases <suite>, runs <suite>, run <suite>, record <suite> --from <file>, golden add|freeze",
  ]);
}

// Shared tail for `evals run` / `evals record`: join adapter output to the
// golden set, record it, apply the gate, print one report. `raw` is whatever
// the runner or the vendor file produced.
function ingestEvalRun(brain, name, loaded, raw, { adapter, dryRun, source }) {
  const { suite, cases, runs } = loaded;
  const adapted = adaptRunOutput(raw, adapter);
  if (adapted.error)
    opError(adapted.error, [
      `source: ${source}`,
      `Declared adapter is "${adapter}" — pass \`--adapter envelope\` if the file is already in brain's envelope shape`,
      'Envelope shape: {"cases":[{"id":"...","output":"...","pass":true,"score":1}]}',
    ]);

  const { scored, unknown, summary } = scoreRun(cases, adapted.cases);
  const prev = lastRun(runs);
  const gate = gateVerdict(suite, summary, prev);
  const ts = new Date().toISOString();

  let recorded = null;
  if (!dryRun) {
    recorded = recordRun(brain, name, {
      suite,
      scored,
      summary,
      usage: adapted.usage,
      ts,
      branch: resolveBranch(brain, undefined),
      commit: gitCommit(brain),
      unknown,
    });
  }

  const prevScore = runScore(prev);
  const failing = scored.filter((s) => !s.pass);
  print([
    "run:",
    kv("suite", name, 2),
    kv("source", source, 2),
    kv("result", `${summary.pass}/${summary.total} pass`, 2),
    kv("score", formatScore(summary.score) || "(unknown)", 2),
    kv(
      "delta",
      summary.score === null
        ? "(unknown)"
        : prevScore === null || prevScore === undefined
          ? "(no prior run)"
          : `${summary.score >= prevScore ? "+" : ""}${(summary.score - prevScore).toFixed(3)}`,
      2
    ),
    kv("gate", `${gate.status} — ${gate.reason}`, 2),
    ...(adapted.usage ? [kv("usage", Object.entries(adapted.usage).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join(", "), 2)] : []),
    ...(recorded ? [kv("recorded", path.join(relBrain(brain), "evals", name, recorded.run_file), 2)] : [kv("recorded", "no — --dry-run", 2)]),
    ...(unknown.length ? [kv("unknown_case_ids", unknown.join(", "), 2)] : []),
    ...(failing.length
      ? toonTable(
          "failing",
          failing.map((f) => ({
            id: f.id,
            frozen: f.frozen ? "yes" : "",
            notes: evalPreview(f.notes || f.output, 80),
          })),
          ["id", "frozen", "notes"]
        )
      : []),
    ...toonList("help", [
      ...(gate.status === "fail"
        ? [
            "Gate FAILED — a frozen case may never regress, whatever the aggregate did (`brain playbook ai` section 5)",
            `Read the failures: \`brain evals view ${name}\``,
          ]
        : []),
      ...(failing.length && gate.status !== "fail"
        ? [`${failing.length} case(s) failing under the gate's tolerance — still worth reading: \`brain evals view ${name}\``]
        : []),
      `Fixed a failure? Encode it: \`brain evals golden freeze ${name} <case-id>\``,
      `Checkpoint the delta: \`brain progress add --eval ${name} --summary "..."\``,
    ]),
  ]);
  if (gate.status === "fail") process.exit(1);
}

// Short commit sha for a run record; empty when this is not a git repo (a
// harness in a non-git directory still records runs, just without provenance).
function gitCommit(brain) {
  const res = spawnSync("git rev-parse --short HEAD", {
    shell: true,
    cwd: repoRoot(brain),
    encoding: "utf8",
  });
  return res.status === 0 ? (res.stdout || "").trim() : "";
}

function cmdEvalsRun(argv) {
  const spec = {
    "--adapter": { value: true, desc: `override the suite's adapter (${EVAL_ADAPTERS.join("|")})` },
    "--dry-run": { value: false, desc: "run and report, but do not record the run" },
    "--timeout": { value: true, desc: "runner timeout in seconds (default: suite.timeout or 600)" },
  };
  const { flags, positionals } = parseArgs(argv, spec, "evals run");
  if (flags.help)
    helpBlock(
      "evals run",
      "Run a suite's declared runner, record the run, and apply the regression gate",
      spec,
      ["brain evals run skill-coverage", "brain evals run skill-coverage --dry-run"],
      ["<suite> — suite name from `brain evals`"]
    );
  const brain = findBrain(flags.brain);
  const name = positionals[0];
  const loaded = requireSuite(brain, name);
  const suite = loaded.suite;
  const adapter = flags.adapter || suite.adapter;
  if (!EVAL_ADAPTERS.includes(adapter))
    usageError(`unknown adapter "${adapter}"`, [`valid adapters: ${EVAL_ADAPTERS.join(", ")}`]);
  const timeoutSec = flags.timeout ? Number(flags.timeout) : suite.timeout || 600;
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0)
    usageError("--timeout must be a positive number of seconds", [`brain evals run ${name} --timeout 120`]);

  const res = spawnSync(suite.runner, {
    shell: true,
    cwd: repoRoot(brain),
    timeout: timeoutSec * 1000,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error && res.error.code === "ETIMEDOUT")
    opError(`runner timed out after ${timeoutSec}s`, [`runner: ${suite.runner}`, `Raise it: \`brain evals run ${name} --timeout ${timeoutSec * 2}\``]);
  if (res.status !== 0) {
    // A signal kill or maxBuffer overflow leaves status null — name what
    // actually happened instead of printing "runner exited null".
    const how = res.status ?? `died (${res.signal || (res.error && res.error.code) || "unknown"})`;
    opError(`runner ${typeof how === "number" ? `exited ${how}` : how}`, [
      `runner: ${suite.runner}`,
      ...tailLines(res.stderr || res.stdout || "", 10).map((l) => `stderr: ${l}`),
      "Nothing was recorded — a half-run is not evidence",
    ]);
  }

  ingestEvalRun(brain, name, loaded, res.stdout || "", {
    adapter,
    dryRun: !!flags["dry-run"],
    source: suite.runner,
  });
}

function cmdEvalsRecord(argv) {
  const spec = {
    "--from": { value: true, desc: "path to a result file the runner already produced (required)" },
    "--adapter": { value: true, desc: `how to read it (${EVAL_ADAPTERS.join("|")}, default: the suite's)` },
    "--dry-run": { value: false, desc: "report, but do not record the run" },
  };
  const { flags, positionals } = parseArgs(argv, spec, "evals record");
  if (flags.help)
    helpBlock(
      "evals record",
      "Record a run produced elsewhere (promptfoo output, a python harness, an agent-scored pass)",
      spec,
      [
        "brain evals record summarizer --from out.json --adapter promptfoo",
        "brain evals record summarizer --from agent-run.json",
      ],
      ["<suite> — suite name from `brain evals`"]
    );
  const brain = findBrain(flags.brain);
  const name = positionals[0];
  const loaded = requireSuite(brain, name);
  if (!flags.from) usageError("--from is required", [`brain evals record ${name} --from <file>`]);
  const file = path.resolve(flags.from);
  if (!fs.existsSync(file)) opError(`no such file: ${flags.from}`, ["Pass the path to the result file your runner wrote"]);
  if (!fs.statSync(file).isFile())
    opError(`--from must be a file, not a directory: ${flags.from}`, ["Pass the path to the result file your runner wrote"]);
  const adapter = flags.adapter || loaded.suite.adapter;
  if (!EVAL_ADAPTERS.includes(adapter))
    usageError(`unknown adapter "${adapter}"`, [`valid adapters: ${EVAL_ADAPTERS.join(", ")}`]);

  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    opError(`could not read ${flags.from} (${e.message})`, ["Pass the path to the result file your runner wrote"]);
  }
  ingestEvalRun(brain, name, loaded, raw, {
    adapter,
    dryRun: !!flags["dry-run"],
    source: path.relative(process.cwd(), file),
  });
}

function cmdEvalsGolden(argv) {
  const sub = argv[0] && !argv[0].startsWith("--") ? argv[0] : null;
  const rest = argv.slice(1);

  if (sub === null && argv.includes("--help"))
    helpBlock(
      "evals golden",
      "Manage a suite's golden set — every fixed AI bug becomes a frozen regression case",
      {},
      [
        'brain evals golden add summarizer --id inv-date --input "..." --frozen',
        "brain evals golden freeze skill-coverage cmd-features",
        "brain evals golden unfreeze skill-coverage cmd-features",
      ],
      ["<suite> — suite name from `brain evals`", "<case-id> — case id from `brain evals cases <suite>`"]
    );

  if (sub === "add") {
    const spec = {
      "--id": { value: true, desc: "case id, unique within the suite (required)" },
      "--input": { value: true, desc: "the case input (required)" },
      "--expected": { value: true, desc: "assertion describing a correct answer" },
      "--frozen": { value: false, desc: "mark as a frozen regression case — may never regress" },
      "--origin": { value: true, desc: `where it came from (${CASE_ORIGINS.join("|")}, default: regression)` },
      "--tag": { value: true, desc: "comma-separated tags" },
      "--note": { value: true, desc: "why this case exists" },
    };
    const { flags, positionals } = parseArgs(rest, spec, "evals golden add");
    if (flags.help)
      helpBlock(
        "evals golden add",
        "Add a case to a suite's golden set — the move after fixing an AI bug",
        spec,
        ['brain evals golden add summarizer --id inv-date --input "..." --expected "does not invent a date" --frozen'],
        ["<suite> — suite name from `brain evals`"]
      );
    const brain = findBrain(flags.brain);
    const name = positionals[0];
    requireSuite(brain, name);
    if (!flags.id) usageError("--id is required", [`brain evals golden add ${name} --id <case-id> --input "..."`]);
    if (flags.input === undefined)
      usageError("--input is required", [`brain evals golden add ${name} --id ${flags.id} --input "..."`]);
    const origin = flags.origin || "regression";
    if (!CASE_ORIGINS.includes(origin))
      usageError(`--origin must be one of ${CASE_ORIGINS.join("|")}`, [`brain evals golden add ${name} --origin regression`]);
    const entry = {
      id: flags.id,
      input: flags.input,
      ...(flags.expected !== undefined ? { expected: flags.expected } : {}),
      tags: flags.tag ? flags.tag.split(",").map((t) => t.trim()).filter(Boolean) : [],
      frozen: !!flags.frozen,
      origin,
      ...(flags.note ? { note: flags.note } : {}),
    };
    const { error } = appendCase(brain, name, entry);
    if (error) opError(error, [`Run \`brain evals cases ${name}\` to see existing ids`]);
    print([
      "case:",
      kv("suite", name, 2),
      kv("id", entry.id, 2),
      kv("frozen", String(entry.frozen), 2),
      kv("origin", entry.origin, 2),
      ...toonList("help", [
        ...(entry.frozen ? [] : ["A case encoding a fixed bug should be frozen — re-add with --frozen, or `brain evals golden freeze`"]),
        `Run \`brain evals run ${name}\` to score it`,
      ]),
    ]);
    return;
  }

  if (sub === "freeze" || sub === "unfreeze") {
    const { flags, positionals } = parseArgs(rest, {}, `evals golden ${sub}`);
    if (flags.help)
      helpBlock(
        `evals golden ${sub}`,
        sub === "freeze"
          ? "Mark an existing case as a frozen regression case (may never regress)"
          : "Un-freeze a case — only when the expectation itself was wrong",
        {},
        [`brain evals golden ${sub} skill-coverage cmd-features`],
        ["<suite> — suite name", "<case-id> — case id from `brain evals cases <suite>`"]
      );
    const brain = findBrain(flags.brain);
    const name = positionals[0];
    const id = positionals[1];
    requireSuite(brain, name);
    if (!id) usageError("missing required argument <case-id>", [`brain evals golden ${sub} ${name} <case-id>`]);
    const { error, entry } = freezeCase(brain, name, id, sub === "freeze");
    if (error) opError(error, [`Run \`brain evals cases ${name}\` to see existing ids`]);
    print([
      "case:",
      kv("suite", name, 2),
      kv("id", entry.id, 2),
      kv("frozen", String(entry.frozen), 2),
      ...toonList("help", [
        sub === "freeze"
          ? "Frozen cases are absolute — the gate fails on any regression here regardless of the aggregate"
          : "Un-freezing removes a hard guarantee — say why in the case's note",
      ]),
    ]);
    return;
  }

  usageError(`unknown subcommand \`evals golden${sub ? " " + sub : ""}\``, [
    "valid subcommands: add <suite> --id ... --input ..., freeze <suite> <case-id>, unfreeze <suite> <case-id>",
  ]);
}

function cmdDocs(argv) {
  const spec = { "--full": { value: false, desc: "with view: print the complete doc" } };
  const sub = argv[0] && !argv[0].startsWith("--") ? argv[0] : null;

  // brain docs view <section>/<name>
  if (sub === "view") {
    const { flags, positionals } = parseArgs(argv.slice(1), spec, "docs view");
    if (flags.help)
      helpBlock("docs view", "Show one brain doc", spec,
        ["brain docs view rules/errors", "brain docs view architecture/security --full"],
        ["<section>/<name> — from `brain docs <section>`"]);
    const ref = positionals[0];
    if (!ref || !ref.includes("/"))
      usageError("missing required argument <section>/<name>", ["brain docs view rules/errors  (see `brain docs`)"]);
    const [section, ...nameParts] = ref.split("/");
    const name = nameParts.join("/");
    const dirName = DOC_SECTIONS[section];
    if (!dirName)
      usageError(`unknown section "${section}"`, [`valid sections: ${Object.keys(DOC_SECTIONS).join(", ")}`]);
    const brain = findBrain(flags.brain);
    const file = path.join(brain, dirName, name.replace(/\.md$/, "") + ".md");
    if (!fs.existsSync(file)) {
      const known = listMd(path.join(brain, dirName), { excludeIndex: false }).map((n) => n.name);
      opError(`no doc "${name}" in ${section}`, [`known docs in ${section}: ${known.join(", ") || "(none)"}`]);
    }
    print([
      "doc:",
      kv("section", section, 2),
      kv("name", name, 2),
      kv("title", firstHeading(file), 2),
      ...bodyLines("body", fs.readFileSync(file, "utf8").trim(), {
        full: !!flags.full,
        fullCommand: `brain docs view ${section}/${name} --full`,
      }),
    ]);
    return;
  }

  // brain docs [<section>]
  const { flags, positionals } = parseArgs(sub ? argv.slice(1) : argv, {}, "docs");
  if (flags.help)
    helpBlock("docs", "Browse brain documentation sections", {},
      ["brain docs", "brain docs rules", "brain docs view rules/errors"],
      ["[section] — one of: " + Object.keys(DOC_SECTIONS).join(", ")]);
  const section = sub || positionals[0];
  const brain = findBrain(flags.brain);

  if (!section) {
    const rows = Object.entries(DOC_SECTIONS).map(([key, dirName]) => ({
      section: key,
      docs: listMd(path.join(brain, dirName)).length,
    })).filter((r) => r.docs > 0);
    print([
      ...toonTable("sections", rows, ["section", "docs"]),
      ...toonList("help", ["Run `brain docs <section>` to list docs in a section"]),
    ]);
    return;
  }

  const dirName = DOC_SECTIONS[section];
  if (!dirName)
    usageError(`unknown section "${section}"`, [`valid sections: ${Object.keys(DOC_SECTIONS).join(", ")}`]);
  const docs = listMd(path.join(brain, dirName));
  if (!docs.length) {
    print([`docs: 0 docs in section ${section}`, ...toonList("help", ["Run `brain docs` to list non-empty sections"])]);
    return;
  }
  const rows = docs.map((d) => ({ name: d.name, title: firstHeading(d.file) }));
  print([
    ...toonTable(section, rows, ["name", "title"]),
    ...toonList("help", [`Run \`brain docs view ${section}/<name>\` to read a doc`]),
  ]);
}

function cmdSearch(argv) {
  const spec = {
    "--limit": { value: true, desc: "max matches to show (default: 20)" },
    "--section": { value: true, desc: "restrict to one section dir (e.g. rules, recipes, runs)" },
  };
  const { flags, positionals } = parseArgs(argv, spec, "search");
  if (flags.help)
    helpBlock("search", "Case-insensitive text search across all brain files", spec,
      ['brain search "tagged error"', 'brain search wrangler --section runs --limit 5'],
      ["<query> — literal text to find"]);
  const query = positionals[0];
  if (!query) usageError("missing required argument <query>", ['brain search "<query>"']);
  const limit = flags.limit ? parseInt(flags.limit, 10) : 20;
  if (!Number.isInteger(limit) || limit < 1)
    usageError(`invalid --limit "${flags.limit}"`, ["--limit takes a positive integer"]);

  const brain = findBrain(flags.brain);
  let root = brain;
  if (flags.section) {
    const dirName = DOC_SECTIONS[flags.section] || flags.section;
    root = path.join(brain, dirName);
    if (!fs.existsSync(root))
      usageError(`unknown --section "${flags.section}"`, [
        `valid sections: ${Object.keys(DOC_SECTIONS).join(", ")}, runs`,
      ]);
  }

  const needle = query.toLowerCase();
  const matches = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(md|json)$/.test(entry.name)) {
        const content = fs.readFileSync(p, "utf8").split("\n");
        content.forEach((line, i) => {
          if (line.toLowerCase().includes(needle))
            matches.push({
              file: path.relative(brain, p),
              line: i + 1,
              text: line.trim().slice(0, 120),
            });
        });
      }
    }
  };
  walk(root);

  if (!matches.length) {
    print([`matches: 0 matches for "${query}" in ${relBrain(root)}`]);
    return;
  }
  const shown = matches.slice(0, limit);
  const lines = [
    kv("count", `${shown.length} of ${matches.length} total`),
    ...toonTable("matches", shown, ["file", "line", "text"]),
  ];
  const help = [];
  if (matches.length > shown.length)
    help.push(`Run \`brain search "${query}" --limit ${matches.length}\` for all matches`);
  help.push("Run `brain docs view <section>/<name> --full` to read a matched doc");
  lines.push(...toonList("help", help));
  print(lines);
}

// Compact dashboard for session-start hooks. Ruthlessly minimal.
function cmdContext(argv) {
  const { flags } = parseArgs(argv, {}, "context");
  if (flags.help)
    helpBlock("context", "Compact session-start dashboard (used by installed hooks)", {}, ["brain context"]);
  const brain = findBrain(flags.brain, { optional: true });
  if (!brain) return; // hook context outside a brain repo: stay silent
  const list = loadFeatureList(brain);
  const progress = parseProgress(brain);
  const counts = featureStats(list);
  const inProgress = list.features.filter((f) => f.status === "in-progress");
  const lines = [
    kv("brain", relBrain(brain)),
    kv(
      "features",
      `${list.features.length} total (${Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(", ")})`
    ),
    kv("in-progress", inProgress.length ? inProgress.map((f) => f.slug).join(", ") : "none"),
  ];
  if (progress.entries.length) {
    const top = progress.entries[0];
    lines.push(kv("last-checkpoint", `${top.date} — ${top.summary}`));
    const next = top.body.match(/^- next: (.+)$/m);
    if (next) lines.push(kv("next", next[1]));
  }
  lines.push(...toonList("help", ["Run `brain` for the full dashboard, `brain progress` for the latest checkpoint"]));
  print(lines);
}

// ---------------------------------------------------------------------------
// Review — human-in-the-loop plan review (server.js owns the HTTP surface;
// the CLI only talks to it over loopback HTTP + reads store.js directly for
// `review list`, which needs no running server).
// ---------------------------------------------------------------------------

function resolveReviewPort(flags) {
  if (flags.port !== undefined) {
    const n = parseInt(flags.port, 10);
    if (!Number.isInteger(n) || n < 1) usageError(`invalid --port "${flags.port}"`, ["--port takes a positive integer"]);
    return n;
  }
  if (process.env.BRAIN_AXI_PORT) {
    const n = parseInt(process.env.BRAIN_AXI_PORT, 10);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return REVIEW_DEFAULT_PORT;
}

async function fetchHealth(port, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHealth(port, capMs = 5000) {
  const start = Date.now();
  for (;;) {
    const h = await fetchHealth(port, 800);
    if (h) return h;
    if (Date.now() - start >= capMs) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function waitForPortFree(port, capMs = 5000) {
  const start = Date.now();
  for (;;) {
    const h = await fetchHealth(port, 500);
    if (!h) return true;
    if (Date.now() - start >= capMs) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
}

function spawnReviewServer(port) {
  const dir = stateDir();
  const fd = fs.openSync(path.join(dir, "server.log"), "a");
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, BRAIN_AXI_PORT: String(port) },
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  child.on("error", () => {}); // never crash the CLI over a spawn failure; health polling reports it
  child.unref();
  fs.closeSync(fd);
}

// Ensures a live, version-matched server is listening on `port`, spawning
// (and respawning on a version mismatch) as needed.
async function ensureReviewServer(port) {
  let health = await fetchHealth(port);
  if (!health) {
    spawnReviewServer(port);
    health = await waitForHealth(port);
    if (!health)
      opError(`could not start the review server on port ${port}`, [
        `Check ${collapseHome(path.join(stateDir(), "server.log"))} for details`,
        "Try a different port: brain review <html-file> --port <n>",
      ]);
  }
  if (health.version !== OWN_VERSION) {
    await fetch(`http://127.0.0.1:${port}/shutdown`, { method: "POST" }).catch(() => {});
    await waitForPortFree(port);
    spawnReviewServer(port);
    health = await waitForHealth(port);
    if (!health)
      opError(`could not restart the review server on port ${port} after a version mismatch`, [
        `Check ${collapseHome(path.join(stateDir(), "server.log"))} for details`,
      ]);
  }
  return health;
}

function cmdReview(argv) {
  const sub = argv[0];
  if (sub === "poll") return cmdReviewPoll(argv.slice(1));
  if (sub === "end") return cmdReviewEnd(argv.slice(1));
  if (sub === "list") return cmdReviewList(argv.slice(1));
  return cmdReviewOpen(argv);
}

function cmdReviewOpen(argv) {
  const spec = {
    "--no-open": { value: false, desc: "do not open the system browser" },
    "--reopen": { value: false, desc: "resume a session the user ended (bypasses the user-end latch)" },
    "--plan": { value: true, desc: "plan slug to associate (default: derived from filename + today's date)" },
    "--feature": { value: true, desc: "feature slug to bind this plan under (roots it in .brain/features/<slug>/plans/)" },
    "--port": { value: true, desc: `review server port (default: ${REVIEW_DEFAULT_PORT} or BRAIN_AXI_PORT)` },
  };
  const { flags, positionals } = parseArgs(argv, spec, "review");
  if (flags.help)
    helpBlock(
      "review",
      "Open a human review session for a plan artifact in the browser",
      spec,
      [
        "brain review plan.html",
        "brain review plan.html --plan auth-refactor",
        "brain review plan.html --feature authentication",
        "brain review plan.html --reopen",
      ],
      ["<html-file> — plan artifact (HTML) to review"]
    );
  const file = positionals[0];
  if (!file) usageError("missing required argument <html-file>", ["brain review <html-file>"]);
  const absFile = path.resolve(file);
  if (!fs.existsSync(absFile)) opError(`no such file: ${file}`, ["Pass the path to an existing HTML plan artifact"]);
  return reviewOpenAsync(file, absFile, flags);
}

async function reviewOpenAsync(file, absFile, flags) {
  const port = resolveReviewPort(flags);
  await ensureReviewServer(port);

  let data, ok;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: absFile, plan: flags.plan, feature: flags.feature, reopen: !!flags.reopen }),
    });
    ok = res.ok;
    data = await res.json();
  } catch (e) {
    opError(`could not reach the review server: ${e.message}`, [`Try again: brain review ${file}`]);
  }

  if (!ok) {
    opError(data.error || "the review server rejected the request", [
      data.help || `Try again: brain review ${file}`,
    ]);
  }

  if (data.refused) {
    print([
      `refused: ${data.reason}`,
      ...(data.url ? [kv("url", data.url)] : []),
      ...toonList("help", [`Run \`brain review ${file} --reopen\` to resume the ended session`]),
    ]);
    return;
  }

  print([
    "session:",
    kv("key", data.key, 2),
    kv("url", data.url, 2),
    kv("plan", data.plan, 2),
    ...(data.feature ? [kv("feature", data.feature, 2)] : []),
    kv("status", data.status, 2),
    ...toonList("help", [
      `Run \`brain review poll ${file}\` and leave it running to wait for feedback`,
      `Run \`brain review end ${file}\` once the plan is fully approved`,
      "Annotate elements or leave a message in the browser, then poll for the result",
    ]),
  ]);

  if (!flags["no-open"]) {
    try {
      const opener = process.platform === "darwin" ? "open" : "xdg-open";
      const child = spawn(opener, [data.url], { detached: true, stdio: "ignore" });
      child.on("error", () => {}); // never fail the command if the browser can't be opened
      child.unref();
    } catch {
      // same: opening the browser is best-effort
    }
  }
}

function cmdReviewPoll(argv) {
  const spec = {
    "--agent-reply": { value: true, desc: "reply text to post into the browser chat before waiting" },
    "--snapshot": { value: false, desc: "print the full DOM outline snapshot (else just snapshot_chars)" },
    "--timeout-ms": { value: true, desc: "abort the long-poll after N ms (debug)" },
  };
  const { flags, positionals } = parseArgs(argv, spec, "review poll");
  if (flags.help)
    helpBlock(
      "review poll",
      "Long-poll for feedback on an open review session; leave this running until it returns",
      spec,
      [
        "brain review poll plan.html",
        'brain review poll plan.html --agent-reply "moved the CTA above the fold"',
        "brain review poll plan.html --snapshot",
      ],
      ["<html-file> — plan artifact passed to `brain review`"]
    );
  const file = positionals[0];
  if (!file) usageError("missing required argument <html-file>", ["brain review poll <html-file>"]);
  let timeoutMs = null;
  if (flags["timeout-ms"] !== undefined) {
    timeoutMs = parseInt(flags["timeout-ms"], 10);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1)
      usageError(`invalid --timeout-ms "${flags["timeout-ms"]}"`, ["--timeout-ms takes a positive integer"]);
  }
  return reviewPollAsync(file, flags, timeoutMs);
}

const CODEX_NEXT_STEP_SUFFIX =
  " You appear to be running under Codex: keep this poll attached to the active turn; do not push it to a background task.";
const ANCHOR_HELP_LINE =
  "Each prompt carries line + text anchors — apply edits with targeted reads (offset/limit) and anchored replacements; do NOT re-read the whole artifact.";

function isCodexEnv() {
  return !!(process.env.CODEX_SANDBOX || process.env.CODEX_THREAD_ID);
}

function renderPollResult(data, file, flags = {}) {
  const lines = [kv("status", data.status)];
  let snapshotShown = false;
  if (data.status === "feedback") {
    const prompts = (data.prompts || []).map((p) => ({
      tag: p.tag,
      line: p.line === null || p.line === undefined ? "" : p.line,
      selector: p.selector || "",
      text: p.text || "",
      prompt: p.prompt || "",
    }));
    lines.push(...toonTable("prompts", prompts, ["tag", "line", "selector", "text", "prompt"]));

    if (data.layout_warnings && data.layout_warnings.length) {
      const rows = data.layout_warnings.map((w) => ({
        kind: w.kind,
        selector: w.selector,
        overflowPx: w.overflowPx,
        severity: w.severity,
        persistent: !!w.persistent,
      }));
      lines.push(...toonTable("layout_warnings", rows, ["kind", "selector", "overflowPx", "severity", "persistent"]));
    }

    if (flags.snapshot && data.dom_snapshot) {
      lines.push("snapshot: |");
      for (const l of data.dom_snapshot.split("\n")) lines.push("  " + l);
      snapshotShown = true;
    } else {
      const chars = data.dom_snapshot ? data.dom_snapshot.length : data.dom_snapshot_chars || 0;
      lines.push(kv("snapshot_chars", chars));
    }
  }
  if (data.ended_by) lines.push(kv("ended_by", data.ended_by));
  let nextStep = data.next_step;
  if (nextStep && isCodexEnv()) nextStep += CODEX_NEXT_STEP_SUFFIX;
  if (nextStep) lines.push(kv("next_step", nextStep));

  const help = [];
  if (data.status === "feedback" && !data.session_ended) {
    help.push(`Apply the changes, then run \`brain review poll ${file} --agent-reply "what you changed"\` to continue the loop`);
    if ((data.prompts || []).length) help.push(ANCHOR_HELP_LINE);
    if (!snapshotShown) help.push(`Run \`brain review poll ${file} --snapshot\` to see the full DOM outline`);
    help.push(`Run \`brain review end ${file}\` once the plan is fully approved`);
  } else if (data.session_ended || data.status === "ended") {
    if (data.ended_by === "user") {
      help.push("Apply any remaining feedback, then report in the conversation — do not reopen automatically");
      if ((data.prompts || []).length) help.push(ANCHOR_HELP_LINE);
      help.push(`Run \`brain review ${file} --reopen\` only if the user asks to resume`);
    } else {
      help.push(`Run \`brain review ${file}\` to reopen the session anytime`);
    }
  } else {
    help.push(`Run \`brain review ${file}\` first`);
  }
  lines.push(...toonList("help", help));
  return lines;
}

async function reviewPollAsync(file, flags, timeoutMs) {
  const absFile = path.resolve(file);
  const port = resolveReviewPort(flags);

  let key;
  try {
    key = sessionKey(absFile);
  } catch {
    print(renderPollResult({ status: "missing", next_step: `No session for this file. Run \`brain review ${file}\` first.` }, file, flags));
    return;
  }

  const sigintHandler = () => {
    process.stderr.write("feedback is never lost — re-run the same command to keep waiting\n");
    process.exit(130);
  };
  process.on("SIGINT", sigintHandler);
  process.stderr.write("waiting for feedback… leave this running (Ctrl-C safe: feedback is never lost)\n");

  const waitStart = Date.now();
  const tickTimer = setInterval(() => {
    const mins = Math.round((Date.now() - waitStart) / 60000);
    process.stderr.write(`still waiting ${mins}m — leave running\n`);
  }, 60000);
  if (tickTimer.unref) tickTimer.unref();

  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;

  let url = `http://127.0.0.1:${port}/api/poll?key=${encodeURIComponent(key)}`;
  if (flags["agent-reply"]) url += `&reply=${encodeURIComponent(flags["agent-reply"])}`;

  let text;
  try {
    const res = await fetch(url, { signal: controller.signal });
    text = (await res.text()).trim();
  } catch (e) {
    if (timer) clearTimeout(timer);
    clearInterval(tickTimer);
    process.removeListener("SIGINT", sigintHandler);
    if (e.name === "AbortError") {
      print([kv("status", "timeout"), ...toonList("help", [`Run \`brain review poll ${file}\` again to keep waiting`])]);
      return;
    }
    print(renderPollResult({ status: "missing", next_step: `No session for this file. Run \`brain review ${file}\` first.` }, file, flags));
    return;
  }
  if (timer) clearTimeout(timer);
  clearInterval(tickTimer);
  process.removeListener("SIGINT", sigintHandler);

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    opError("received a malformed response from the review server", [`Run \`brain review poll ${file}\` again`]);
  }
  print(renderPollResult(data, file, flags));
}

function cmdReviewEnd(argv) {
  const { flags, positionals } = parseArgs(argv, {}, "review end");
  if (flags.help)
    helpBlock("review end", "End an open review session (marks the plan reviewed)", {}, ["brain review end plan.html"], [
      "<html-file> — plan artifact passed to `brain review`",
    ]);
  const file = positionals[0];
  if (!file) usageError("missing required argument <html-file>", ["brain review end <html-file>"]);
  return reviewEndAsync(file, flags);
}

async function reviewEndAsync(file, flags) {
  const port = resolveReviewPort(flags);
  let key;
  try {
    key = sessionKey(path.resolve(file));
  } catch {
    print([`review: no active session for ${file} (no-op)`]);
    return;
  }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/end`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, by: "agent" }),
    });
    const data = await res.json();
    print([
      "review:",
      kv("file", file, 2),
      kv("status", data.status || "ended", 2),
      ...toonList("help", [`Run \`brain review ${file}\` to reopen the session anytime`]),
    ]);
  } catch {
    print([`review: no active session for ${file} (no-op)`]);
  }
}

function cmdReviewList(argv) {
  const { flags } = parseArgs(argv, {}, "review list");
  if (flags.help) helpBlock("review list", "List review sessions from the local session store", {}, ["brain review list"]);
  let sessions;
  try {
    sessions = listSessions();
  } catch {
    sessions = [];
  }
  if (!sessions.length) {
    print([
      "sessions: 0 review sessions found",
      ...toonList("help", ["Run `brain review <html-file>` to start one"]),
    ]);
    return;
  }
  const rows = sessions.map((s) => ({ key: s.key, status: s.status, plan: s.plan || "", file: s.file }));
  print([
    ...toonTable("sessions", rows, ["key", "status", "plan", "file"]),
    ...toonList("help", ["Run `brain review poll <html-file>` to wait for feedback on one of these"]),
  ]);
}

// ---------------------------------------------------------------------------
// Plans — brain-recorded plan review history
// ---------------------------------------------------------------------------

function cmdPlans(argv) {
  const sub = argv[0] && !argv[0].startsWith("--") ? argv[0] : "list";
  const rest = sub === argv[0] ? argv.slice(1) : argv;
  if (sub === "list") return cmdPlansList(rest);
  if (sub === "view") return cmdPlansView(rest);
  usageError(`unknown subcommand \`plans ${sub}\``, ["valid subcommands: list (default), view <slug>"]);
}

function cmdPlansList(argv) {
  const { flags } = parseArgs(argv, {}, "plans");
  if (flags.help)
    helpBlock("plans", "List plan review artifacts tracked in this brain", {}, [
      "brain plans",
      "brain plans view <slug>",
    ]);
  const brain = findBrain(flags.brain);
  const plans = listPlans(brain);
  if (!plans.length) {
    print([
      "plans: 0 plans in this brain",
      ...toonList("help", ["Run `brain review <plan.html>` to start the first plan review"]),
    ]);
    return;
  }
  // Feature column only when at least one plan is feature-bound — keeps the
  // common (all-legacy) case exactly as before.
  const hasFeature = plans.some((p) => p.feature);
  const fields = hasFeature ? ["slug", "feature", "title", "status", "rounds"] : ["slug", "title", "status", "rounds"];
  const rows = hasFeature ? plans.map((p) => ({ ...p, feature: p.feature || "" })) : plans;
  print([
    ...toonTable("plans", rows, fields),
    ...toonList("help", ["Run `brain plans view <slug>` for review rounds and prompts"]),
  ]);
}

function truncateField(s, limit) {
  if (!s || s.length <= limit) return s || "";
  return s.slice(0, limit) + ` ... (${s.length} chars total, use --full)`;
}

function cmdPlansView(argv) {
  const spec = { "--full": { value: false, desc: "show every review round with complete prompt text" } };
  const { flags, positionals } = parseArgs(argv, spec, "plans view");
  if (flags.help)
    helpBlock(
      "plans view",
      "Show one plan's meta plus its recent review rounds",
      spec,
      ["brain plans view 2026-07-13-auth-refactor", "brain plans view 2026-07-13-auth-refactor --full"],
      ["<slug> — plan slug from `brain plans`"]
    );
  const slug = positionals[0];
  if (!slug) usageError("missing required argument <slug>", ["brain plans view <slug>  (see `brain plans`)"]);
  const brain = findBrain(flags.brain);
  const plan = getPlan(brain, slug);
  if (!plan) opError(`no plan "${slug}"`, [`known plans: ${listPlans(brain).map((p) => p.slug).join(", ") || "(none)"}`]);

  const lines = [
    "plan:",
    kv("slug", plan.slug, 2),
    kv("title", plan.title, 2),
    ...(plan.feature ? [kv("feature", plan.feature, 2)] : []),
    kv("status", plan.status, 2),
    kv("rounds", plan.rounds, 2),
    kv("created", plan.created, 2),
    kv("updated", plan.updated, 2),
    kv("file", plan.file, 2),
  ];

  const allRounds = plan.reviews || [];
  const shownRounds = flags.full ? allRounds : allRounds.slice(-5);
  if (shownRounds.length) {
    for (const r of [...shownRounds].reverse()) {
      lines.push(`round ${r.round} (${r.at}${r.ended_by ? `, ended by ${r.ended_by}` : ""}):`);
      const snap = (plan.snapshots || []).find((s) => s.round === r.round);
      if (snap) lines.push(kv("snapshot", snap.path, 2));
      const prompts = (r.prompts || []).map((p) => ({
        tag: p.tag,
        selector: p.selector || "",
        text: p.text || "",
        prompt: flags.full ? p.prompt || "" : truncateField(p.prompt || "", 200),
      }));
      lines.push(...toonTable("prompts", prompts, ["tag", "selector", "text", "prompt"], 2));
    }
  } else {
    lines.push("rounds: 0 review rounds recorded yet");
  }

  const help = [];
  if (!flags.full && allRounds.length > shownRounds.length)
    help.push(`Run \`brain plans view ${slug} --full\` for all ${allRounds.length} rounds with complete prompt text`);
  // A snapshot is written for EVERY round, approved or not — `ended_by` is the
  // only signal that a round concluded the review rather than requesting more
  // changes. Never label an open round's draft "approved": that would point
  // verification at a change-request artifact.
  const endedRound = [...allRounds].reverse().find((r) => r.ended_by);
  const snapFor = (round) => (plan.snapshots || []).find((s) => s.round === round);
  const approvedSnap = endedRound && snapFor(endedRound.round);
  const lastSnap = (plan.snapshots || []).slice(-1)[0];
  if (approvedSnap)
    help.push(
      `Approved artifact for round ${approvedSnap.round} is frozen at \`${approvedSnap.path}\` — compare shipped UI against that snapshot, not the live file`
    );
  else if (lastSnap)
    help.push(
      `No approved snapshot yet — no review round has ended; \`${lastSnap.path}\` (round ${lastSnap.round}) is the latest draft, do not verify against it as if approved`
    );
  help.push(`Run \`brain review ${plan.file}\` to open or resume this plan`);
  lines.push(...toonList("help", help));
  print(lines);
}

// ---------------------------------------------------------------------------
// Shots — review screenshot gallery
// ---------------------------------------------------------------------------

function cmdShots(argv) {
  const sub = argv[0] && !argv[0].startsWith("--") ? argv[0] : null;
  if (sub === "add") return cmdShotsAdd(argv.slice(1));
  if (sub === "notes") return cmdShotsNotes(argv.slice(1));
  return cmdShotsList(argv);
}

// Read a feature's open (non-superseded) annotation count per shot rel.
// Cheap on the no-annotations path: listAnnotations is a single
// fs.existsSync check when there's no annotations.json for that feature, and
// this is called at most once per unique feature slug in the listing.
function openNotesByRel(brain, features) {
  const map = new Map();
  let annotated = false;
  for (const feature of features) {
    let annotations;
    try {
      annotations = listAnnotations(brain, feature);
    } catch (e) {
      opError(e.message, [`Check .brain/features/${feature}/screenshots/annotations.json for valid JSON`]);
    }
    for (const a of annotations) {
      if (a.superseded) continue;
      annotated = true;
      map.set(a.shot, (map.get(a.shot) || 0) + 1);
    }
  }
  return { map, annotated };
}

function cmdShotsList(argv) {
  const { flags, positionals } = parseArgs(argv, {}, "shots");
  if (flags.help)
    helpBlock(
      "shots",
      "List review screenshots stored in the brain (merged: per-feature + legacy)",
      {},
      ["brain shots", "brain shots authentication", "brain shots add ./01-signin.png --feature authentication --step 01-signin"],
      ["[feature] — optional feature slug (or legacy scope name) to filter by"]
    );
  const filter = positionals[0];
  const brain = findBrain(flags.brain);
  const shots = listShots(brain, filter);
  if (!shots.length) {
    print([
      `shots: 0 screenshots${filter ? ` for ${filter}` : ""} in this brain`,
      ...toonList("help", ["Run `brain shots add <img> --feature <slug> --step <NN-name>` to add one"]),
    ]);
    return;
  }
  const features = [...new Set(shots.map((s) => s.feature).filter(Boolean))];
  const { map: notesByRel, annotated } = openNotesByRel(brain, features);
  const rows = shots.map((s) => {
    const row = { feature: s.feature || "", scope: s.scope || "", file: s.file, rel: s.rel, caption: s.caption };
    if (annotated) row.notes = notesByRel.get(s.rel) || 0;
    return row;
  });
  const fields = annotated
    ? ["feature", "scope", "file", "rel", "caption", "notes"]
    : ["feature", "scope", "file", "rel", "caption"];
  print([
    ...toonTable("shots", rows, fields),
    ...toonList("help", [
      "Run `brain plans view <slug>` or `brain review <plan.html> --feature <slug>` to see shots alongside a plan",
      ...(annotated ? ["Run `brain shots notes <feature>` to read the pinned annotations"] : []),
    ]),
  ]);
}

function cmdShotsNotes(argv) {
  const { flags, positionals } = parseArgs(argv, {}, "shots notes");
  if (flags.help)
    helpBlock(
      "shots notes",
      "List reviewer pin+note annotations dropped on a feature's screenshots",
      {},
      ["brain shots notes authentication"],
      ["<feature> — feature slug from `brain features`"]
    );
  const feature = positionals[0];
  if (!feature) usageError("missing required argument <feature>", ["brain shots notes <feature>"]);
  const brain = findBrain(flags.brain);
  const list = loadFeatureList(brain);
  const feat = list.features.find((f) => f.slug === feature || f.id === feature);
  if (!feat) opError(`no feature "${feature}"`, [`known slugs: ${list.features.map((f) => f.slug).join(", ")}`]);

  let annotations;
  try {
    annotations = listAnnotations(brain, feat.slug);
  } catch (e) {
    opError(e.message, [`Check .brain/features/${feat.slug}/screenshots/annotations.json for valid JSON`]);
  }

  if (!annotations.length) {
    print([
      `notes: 0 annotations for ${feat.slug}`,
      ...toonList("help", [
        `Run \`brain watch ${feat.slug}\` and pin a note on a screenshot in the carousel to create one`,
        `Run \`brain shots ${feat.slug}\` to see this feature's screenshots`,
      ]),
    ]);
    return;
  }

  const sorted = [...annotations].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const openCount = sorted.filter((a) => !a.superseded).length;
  const supersededCount = sorted.length - openCount;
  const unsentCount = sorted.filter((a) => !a.sentAt).length;
  const rows = sorted.map((a) => ({
    shot: a.shot,
    pin: a.x != null && a.y != null ? `${a.x}%,${a.y}%` : "-",
    note: truncateNote(a.note || "", 120),
    at: a.at,
    status: a.superseded ? "superseded" : "open",
    sent: a.sentAt ? a.sentAt.slice(0, 10) : "no",
  }));

  print([
    `notes: ${sorted.length} annotations for ${feat.slug} (${openCount} open, ${supersededCount} superseded, ${unsentCount} unsent)`,
    ...toonTable("annotations", rows, ["shot", "pin", "note", "at", "status", "sent"]),
    ...toonList("help", [
      `Run \`brain watch ${feat.slug}\` to see these pins over the actual screenshots in the carousel`,
      `Run \`brain shots add <img> --feature ${feat.slug} --step <NN-name>\` to re-capture a shot — this supersedes its open annotations`,
      ...(unsentCount ? [`${unsentCount} pin(s) are still unsent drafts — the reviewer clicks "Send to Claude" in the carousel when ready`] : []),
    ]),
  ]);
}

function truncateNote(s, limit) {
  if (!s || s.length <= limit) return s || "";
  return s.slice(0, limit - 1) + "…";
}

const SHOT_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

function cmdShotsAdd(argv) {
  const spec = {
    "--feature": { value: true, desc: "feature slug to file this screenshot under (primary form; requires --step)" },
    "--step": { value: true, desc: "step name, e.g. 01-signin or E1-bad-login — becomes the filename with --feature" },
    "--scope": { value: true, desc: "legacy: plan/feature scope name — writes .brain/screenshots/<scope>/" },
    "--caption": { value: true, desc: "optional caption text" },
  };
  const { flags, positionals } = parseArgs(argv, spec, "shots add");
  if (flags.help)
    helpBlock(
      "shots add",
      "Copy a screenshot into the brain's per-feature or legacy screenshots tree",
      spec,
      [
        "brain shots add ./01-signin.png --feature authentication --step 01-signin",
        "brain shots add ./before.png --scope auth-refactor  (legacy)",
      ],
      ["<img> — path to a png/jpg/jpeg/gif/webp file"]
    );
  const img = positionals[0];
  if (!img)
    usageError("missing required argument <img>", ["brain shots add <img> --feature <slug> --step <NN-name>"]);
  const ext = path.extname(img).toLowerCase();
  if (!SHOT_EXTS.includes(ext)) usageError(`unsupported image extension "${ext}"`, [`valid extensions: ${SHOT_EXTS.join(", ")}`]);
  if (!fs.existsSync(img)) opError(`no such file: ${img}`, ["Pass the path to an existing screenshot file"]);

  if (!flags.feature && !flags.scope)
    usageError("either --feature (with --step) or --scope is required", [
      `brain shots add ${img} --feature <slug> --step <NN-name>`,
      `brain shots add ${img} --scope <plan-or-feature>  (legacy)`,
    ]);
  if (flags.feature && flags.scope)
    usageError("pass either --feature or --scope, not both", [`brain shots add ${img} --feature ${flags.feature} --step <NN-name>`]);
  if (flags.feature && !flags.step)
    usageError("--step is required with --feature", [`brain shots add ${img} --feature ${flags.feature} --step <NN-name>`]);

  const brain = findBrain(flags.brain);
  const { rel } = addShot(brain, img, { feature: flags.feature, step: flags.step, scope: flags.scope, caption: flags.caption });
  const scopeLabel = flags.feature || flags.scope;
  print([
    "shot:",
    kv("rel", rel, 2),
    kv(flags.feature ? "feature" : "scope", scopeLabel, 2),
    ...toonList("help", ["Run `brain shots` to see all screenshots", `Run \`brain shots ${scopeLabel}\` to see this one`]),
  ]);
}

// ---------------------------------------------------------------------------
// Verifications — feature-verifier browser-walk verdict docs
// ---------------------------------------------------------------------------

function cmdVerifications(argv) {
  if (argv[0] === "view") return cmdVerificationsView(argv.slice(1));
  return cmdVerificationsList(argv);
}

function cmdVerificationsList(argv) {
  const { flags, positionals } = parseArgs(argv, {}, "verifications");
  if (flags.help)
    helpBlock(
      "verifications",
      "List feature verification (browser-walk) verdict docs",
      {},
      ["brain verifications", "brain verifications authentication", "brain verifications view authentication 2026-07-14"],
      ["[feature] — optional feature slug to filter by"]
    );
  const feature = positionals[0];
  const brain = findBrain(flags.brain);
  const rows = listVerifications(brain, feature);
  if (!rows.length) {
    print([
      `verifications: 0 verification docs${feature ? ` for ${feature}` : ""} in this brain`,
      ...toonList("help", ["Run `npx -y brain-axi playbook verify` for the verification doc standard"]),
    ]);
    return;
  }
  print([
    ...toonTable("verifications", rows, ["feature", "date", "verdict", "file"]),
    ...toonList("help", ["Run `brain verifications view <feature> <date>` to read one"]),
  ]);
}

function cmdVerificationsView(argv) {
  const spec = { "--full": { value: false, desc: "print the complete verification doc body" } };
  const { flags, positionals } = parseArgs(argv, spec, "verifications view");
  if (flags.help)
    helpBlock(
      "verifications view",
      "Show one feature verification doc",
      spec,
      ["brain verifications view authentication 2026-07-14", "brain verifications view authentication 2026-07-14 --full"],
      ["<feature> — feature slug", "<date> — YYYY-MM-DD"]
    );
  const [feature, date] = positionals;
  if (!feature || !date)
    usageError("missing required arguments <feature> <date>", ["brain verifications view <feature> <date>  (see `brain verifications`)"]);
  const brain = findBrain(flags.brain);
  const v = getVerification(brain, feature, date);
  if (!v)
    opError(`no verification doc for ${feature}/${date}`, [`Run \`brain verifications ${feature}\` to list known dates`]);
  print([
    "verification:",
    kv("feature", feature, 2),
    kv("date", date, 2),
    kv("verdict", v.meta.verdict, 2),
    kv("file", v.meta.file, 2),
    ...bodyLines("body", v.body.trim(), {
      full: !!flags.full,
      fullCommand: `brain verifications view ${feature} ${date} --full`,
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Timeline — merged brain history
// ---------------------------------------------------------------------------

function cmdTimeline(argv) {
  const spec = { "--limit": { value: true, desc: "max entries to show (default: 30)" } };
  const { flags } = parseArgs(argv, spec, "timeline");
  if (flags.help)
    helpBlock("timeline", "Merged brain timeline: checkpoints, run notes, plan creations, review rounds", spec, [
      "brain timeline",
      "brain timeline --limit 50",
    ]);
  const limit = flags.limit ? parseInt(flags.limit, 10) : 30;
  if (!Number.isInteger(limit) || limit < 1) usageError(`invalid --limit "${flags.limit}"`, ["--limit takes a positive integer"]);
  const brain = findBrain(flags.brain);
  const entries = brainTimeline(brain, { limit });
  if (!entries.length) {
    print([
      "timeline: 0 entries in this brain",
      ...toonList("help", [
        'Run `brain progress add --summary "..."` or `brain review <plan.html>` to start recording history',
      ]),
    ]);
    return;
  }
  print([
    ...toonTable("timeline", entries, ["at", "type", "summary", "ref"]),
    ...toonList("help", ["Run `brain progress` or `brain plans view <slug>` for more detail on any entry"]),
  ]);
}

// ---------------------------------------------------------------------------
// Playbook — authoring standards for agent-produced review artifacts
// ---------------------------------------------------------------------------

function cmdPlaybook(argv) {
  const { flags, positionals } = parseArgs(argv, {}, "playbook");
  if (flags.help)
    helpBlock(
      "playbook",
      "Show authoring playbooks for agent-produced artifacts (e.g. the plan review HTML)",
      {},
      ["brain playbook", "brain playbook plan"],
      ["[id] — playbook id from `brain playbook`"]
    );
  const id = positionals[0];
  if (!id) {
    const rows = Object.values(PLAYBOOKS).map((p) => ({ id: p.id, use_when: p.use_when }));
    print([
      ...toonTable("playbooks", rows, ["id", "use_when"]),
      ...toonList("help", ["Run `brain playbook <id>` to see the full playbook"]),
    ]);
    return;
  }
  const pb = PLAYBOOKS[id];
  if (!pb) opError(`no playbook "${id}"`, [`known playbooks: ${Object.keys(PLAYBOOKS).join(", ")}`]);
  print([
    "playbook: |",
    ...pb.content.split("\n").map((l) => "  " + l),
    ...toonList("help", [
      "Follow this playbook step by step while writing the artifact",
      "Run `brain playbook` to see all available playbooks",
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Init — scaffold a minimal .brain skeleton (deliberately NOT the full example
// brain: terse, placeholder-marked templates the project fills in itself).
// ---------------------------------------------------------------------------

// Any filesystem entry at p, including a broken symlink — fs.existsSync
// follows symlinks and reports false for a dangling one, which would let us
// clobber it. lstat doesn't follow, so it sees the link itself either way.
function pathExistsAny(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function writeInitFile(created, root, filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  // Paths in the created[] list read relative to the scaffolded root, not the
  // invoker's cwd — `.brain/HARNESS.md`, never a ../../ chain out of --dir.
  created.push(path.relative(root, filePath));
}

function initHarnessTemplate() {
  return [
    "# HARNESS.md — the harness, explained",
    "",
    '> One-stop explainer for what holds this project together for AI agents. Read this once when joining the repo; update it when the harness itself changes (not when individual features change — that\'s .brain/features/).',
    "",
    "This repo runs a 5-subsystem harness:",
    "",
    "1. **Instructions** — what to read before working. <name your instruction docs here — CLAUDE.md/AGENTS.md, .brain/rules/, .brain/codebase/, .brain/high-level-architecture/>",
    "2. **State** — what's done, in progress, where things were left off. `features/feature_list.json` (status/dependencies/evidence) + `runs/progress.md` (rolling session cursor) + `runs/<date>-<slug>.md` (deep per-task state).",
    "3. **Verification** — how to prove a change is correct. `.brain/verify.json` registers your project's real checks (typecheck/test/build/lint); `brain verify` runs them. <replace the placeholder check with your real commands>",
    '4. **Scope** — what counts as "this task" (and what doesn\'t). `policy.one_in_progress_at_a_time` in `feature_list.json` enforces one feature in flight at a time. <add project-specific scope rules here>',
    "5. **Lifecycle** — bootstrap, session handoff, clean restart. <describe how a fresh agent should pick this up — usually: run `brain` (or `npx -y brain-axi`), read `runs/progress.md`, check `brain features`>",
    "",
    "Operate this harness with the `brain` CLI (`npx -y brain-axi <command>` if it isn't installed on PATH): `brain features`, `brain progress`, `brain docs`, `brain search`, `brain check`, `brain verify`. Run `brain` with no arguments for the live dashboard.",
    "",
    "## Fill these in",
    "",
    "- [ ] Name the real doc locations for the Instructions layer above.",
    "- [ ] Replace the placeholder check in `.brain/verify.json` with your real typecheck/test/build/lint commands.",
    "- [ ] Add your first feature to `features/feature_list.json` (or via `brain features` once one exists).",
    "- [ ] Fill in `rules/`, `recipes/`, `codebase/`, `high-level-architecture/` as real docs accumulate — the `index.md` stubs are placeholders.",
    "- [ ] Describe any project-specific scope/lifecycle rules above.",
    "",
  ].join("\n");
}

function initFeatureListJson(today) {
  const doc = {
    $schema:
      "Machine-readable feature state tracker. Source of truth for status; per-feature MD docs are source of truth for design/runtime.",
    updated: today,
    policy: {
      one_in_progress_at_a_time: true,
      definition_of_done:
        "implementation complete + `brain verify` green + feature doc updated + `brain check` green",
    },
    features: [],
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

function initFeaturesIndexMd() {
  return [
    "# Features",
    "",
    "One markdown doc per feature (design/runtime detail) lives alongside `feature_list.json`'s status/dependencies/evidence tracker, at `features/<slug>/<slug>.md`. Run `brain features` for the live list, `brain features view <slug>` for one feature's tracker fields + doc body.",
    "",
  ].join("\n");
}

function initRunsIndexMd() {
  return [
    "# Runs",
    "",
    "Per-task deep state lives here as `<YYYY-MM-DD>-<slug>.md` — one per non-trivial task (baselines, dead ends, decisions, verbatim command output). `progress.md` in this same directory is the rolling session cursor, not a run note — don't confuse the two. Run `brain runs` for the live list.",
    "",
  ].join("\n");
}

function initSectionIndexMd(title, body, cliSection) {
  return [`# ${title}`, "", `${body} Run \`brain docs ${cliSection}\` for the live list.`, ""].join("\n");
}

// Evals are optional per repo, so init scaffolds only the index that explains
// the shape — never an empty suite directory that would list as a broken suite.
function initEvalsIndexMd() {
  return [
    "# Evals",
    "",
    "One directory per eval suite — the golden set and run history for anything whose output comes from a model.",
    "",
    "```",
    "evals/<suite>/",
    "  suite.json      kind, runner, adapter, thresholds, prompt pointers",
    "  cases.jsonl     the golden set — one JSON object per line",
    "  runs.jsonl      run history summaries (committed)",
    "  runs/<ts>.json  full per-case results for one run",
    "  feedback/<date>.md   human review notes on prompts + outputs",
    "```",
    "",
    `suite.json shape: \`${SUITE_SNIPPET}\``,
    "",
    "A case is `{id, input, expected, tags[], frozen, origin, note}`. `frozen: true` means the case may never regress at any aggregate score — that is the gate.",
    "",
    "Run `brain evals` for the live list and `brain playbook ai` for the standard: how to build the golden set, which eval kind to use, and the change loop (baseline → one change → re-run → compare per-case).",
    "",
  ].join("\n");
}

function initVerifyJson() {
  const doc = {
    version: 1,
    checks: [
      {
        name: "placeholder",
        run: "echo replace this with your typecheck/test/build commands",
        stages: ["bootstrap", "baseline", "verify"],
      },
    ],
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

function initChangelogMd(today) {
  return [
    "# CHANGELOG",
    "",
    "High-level architectural / brain-harness shifts — not a code changelog (use `git log` for that).",
    "",
    `## ${today}`,
    "",
    "- Initialized `.brain/` via `brain init`.",
    "",
  ].join("\n");
}

function initProgressMd(today, branch) {
  return [
    "# Progress — rolling session log",
    "",
    '> Single rolling log of "where am I right now". Append-only. Newest entry on top. Per-task deep state lives in `<YYYY-MM-DD>-<slug>.md` in this same directory — this file is just the cursor.',
    "",
    "## How to use",
    "",
    "- **Start of session**: read the top entry to recover state.",
    '- **During session**: append one checkpoint per meaningful step (decision, blocker, branch switch, test failure, scope change) via `brain progress add --summary "..."`.',
    '- **End of session**: `brain progress add --summary "..." --next "..."` so the next session picks up cleanly.',
    "",
    "## Format per entry",
    "",
    "```",
    "## YYYY-MM-DD — <one-line summary>",
    "- branch: <branch-name>",
    "- in-progress feature: <slug> | none",
    "- run note: <path or none>",
    "- next: <one sentence>",
    "```",
    "",
    "---",
    "",
    "## " + today + " — brain initialized via `brain init`",
    "- branch: `" + branch + "`",
    "- in-progress feature: none",
    "- run note: none",
    "",
  ].join("\n");
}

function initAgentsMd() {
  return [
    "# AGENTS.md",
    "",
    "This repo has a `.brain/` agent harness. Before starting any task:",
    "",
    "- Run `npx -y brain-axi` (or `brain`, if installed on PATH) for the live dashboard.",
    "- Read `.brain/HARNESS.md` once — it explains the 5-subsystem harness (instructions, state, verification, scope, lifecycle) and where each piece lives.",
    "",
    "Bookend every non-trivial task:",
    "",
    "- `npx -y brain-axi playbook start` — before writing a line of code",
    "- `npx -y brain-axi playbook done` — before declaring the task complete",
    "",
  ].join("\n");
}

function promptYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

// ---------------------------------------------------------------------------
// init --state-only — the clone case
//
// A repo cloned from a template inherits the TEMPLATE's `.brain`: its features,
// its rolling cursor, its run notes, its screenshots. Bare `brain init` refuses
// (correctly — it must never clobber), so there was no supported way to start
// clean, and every clone was born believing it had shipped another project's
// features. That is context drift installed as a default.
//
// The split is by subsystem, not by age: STATE is another project's history and
// must go; DOCS describe the stack the clone inherits along with the code, so
// they stay. Nothing is archived — the template's git history already has it.
// ---------------------------------------------------------------------------

const STATE_ONLY_WIPE = ["features", "runs", "plans", "screenshots", "evals"];
const STATE_ONLY_KEEP = [
  "rules",
  "recipes",
  "codebase",
  "high-level-architecture",
  "transcripts",
  "emails",
  "HARNESS.md",
  "verify.json",
  "CHANGELOG.md",
];

function initStateOnly(flags) {
  if (flags.brain !== undefined)
    usageError("--brain is not meaningful for `init --state-only` — pass --dir <repo root>", [
      "brain init --state-only --dir <repo-root> --yes",
    ]);
  const root = path.resolve(flags.dir || ".");
  const brainDir = path.join(root, ".brain");
  if (!fs.existsSync(brainDir))
    opError(`no ${path.relative(process.cwd(), brainDir)} to reset`, [
      "Run `brain init` to scaffold a new harness instead",
    ]);

  // Destructive and irreversible in the working tree — require an explicit
  // acknowledgement when nobody is watching.
  if (!flags.yes && !process.stdin.isTTY)
    opError("refusing to wipe brain state non-interactively without --yes", [
      `brain init --state-only --dir ${path.relative(process.cwd(), root) || "."} --yes`,
      `It deletes ${STATE_ONLY_WIPE.join(", ")} under .brain/ and keeps ${STATE_ONLY_KEEP.slice(0, 4).join(", ")}, …`,
    ]);

  const today = new Date().toISOString().slice(0, 10);
  const branch = resolveBranch(brainDir, undefined);
  const removed = [];
  const kept = [];

  for (const name of STATE_ONLY_WIPE) {
    const target = path.join(brainDir, name);
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    removed.push(name);
  }
  for (const name of STATE_ONLY_KEEP) {
    if (fs.existsSync(path.join(brainDir, name))) kept.push(name);
  }

  // Re-scaffold the state subsystem only, reusing the same templates `init` uses
  // so a reset brain and a fresh one are byte-identical in shape.
  const created = [];
  writeInitFile(created, root, featureListPath(brainDir), initFeatureListJson(today));
  writeInitFile(created, root, path.join(brainDir, "runs", "progress.md"), initProgressMd(today, branch));

  const checks = brainCheck(brainDir);
  const failed = checks.filter((c) => c.status === "fail");

  const lines = [
    "init:",
    kv("mode", "state-only", 2),
    kv("brain", path.relative(process.cwd(), brainDir) || ".brain", 2),
    ...toonList("removed", removed.length ? removed : ["(nothing — state was already empty)"], 2),
    ...toonList("kept", kept.length ? kept : ["(no doc sections found)"], 2),
    ...toonList("created", created, 2),
  ];
  if (failed.length) lines.push(...toonTable("checks", failed, ["check", "status", "detail"]));
  print([
    ...lines,
    ...toonList(
      "help",
      failed.length
        ? [`${failed.length} check(s) failing after reset — run \`brain check\` for the full table`]
        : [
            "Brain state is clean — run `brain` for the dashboard",
            "Fill in the kept doc sections for THIS project, then `brain playbook start` on the first task",
          ]
    ),
  ]);
  if (failed.length) process.exit(1);
}

function cmdInit(argv) {
  const spec = {
    "--dir": { value: true, desc: "target root directory to scaffold .brain into (default: cwd)" },
    "--agents-md": { value: false, desc: "write an AGENTS.md pointer + CLAUDE.md symlink" },
    "--no-agents-md": { value: false, desc: "skip the AGENTS.md pointer (default when non-interactive)" },
    "--yes": { value: false, desc: "accept defaults non-interactively (skips the AGENTS.md prompt)" },
    "--state-only": {
      value: false,
      desc: "reset an EXISTING .brain's state (features/, runs/, plans/) but keep its docs — for a repo cloned from a template",
    },
  };
  const { flags } = parseArgs(argv, spec, "init");
  if (flags.help)
    helpBlock(
      "init",
      "Scaffold a minimal .brain skeleton (5-subsystem harness stub) into a repo",
      spec,
      [
        "brain init",
        "brain init --dir ./my-repo",
        "brain init --agents-md",
        "brain init --state-only --yes",
      ]
    );
  if (flags["state-only"]) return initStateOnly(flags);
  if (flags.brain !== undefined)
    usageError("--brain is not meaningful for `init` — this command CREATES a .brain, it doesn't read one", [
      "brain init [--dir <path>]  (defaults to scaffolding .brain in the current directory)",
    ]);
  if (flags["agents-md"] && flags["no-agents-md"])
    usageError("pass either --agents-md or --no-agents-md, not both", [
      "brain init --agents-md",
      "brain init --no-agents-md",
    ]);

  const root = path.resolve(flags.dir || ".");
  const brainDir = path.join(root, ".brain");
  if (fs.existsSync(brainDir))
    opError(`${path.relative(process.cwd(), brainDir)} already exists — already initialized`, [
      "Run `brain` for the live dashboard, or `brain check` to verify the existing harness",
    ]);

  return initAsync(root, brainDir, flags);
}

async function initAsync(root, brainDir, flags) {
  const today = new Date().toISOString().slice(0, 10);
  const branch = resolveBranch(brainDir, undefined);
  const created = [];
  const skipped = [];

  writeInitFile(created, root, path.join(brainDir, "HARNESS.md"), initHarnessTemplate());
  writeInitFile(created, root, featureListPath(brainDir), initFeatureListJson(today));
  writeInitFile(created, root, path.join(brainDir, DOC_SECTIONS.features, "index.md"), initFeaturesIndexMd());
  writeInitFile(created, root, path.join(brainDir, "runs", "progress.md"), initProgressMd(today, branch));
  writeInitFile(created, root, path.join(brainDir, "runs", "index.md"), initRunsIndexMd());
  writeInitFile(
    created,
    root,
    path.join(brainDir, DOC_SECTIONS.rules, "index.md"),
    initSectionIndexMd("Rules", "Add layer-aligned do/don't rules here as they emerge — one doc per layer or concern.", "rules")
  );
  writeInitFile(
    created,
    root,
    path.join(brainDir, DOC_SECTIONS.recipes, "index.md"),
    initSectionIndexMd(
      "Recipes",
      'Add deterministic runbooks here (e.g. bookended by a "before task" and "verify done" recipe).',
      "recipes"
    )
  );
  writeInitFile(
    created,
    root,
    path.join(brainDir, DOC_SECTIONS.codebase, "index.md"),
    initSectionIndexMd(
      "Codebase",
      "Add programming-model docs here — language/framework conventions, key abstractions, module layout.",
      "codebase"
    )
  );
  writeInitFile(
    created,
    root,
    path.join(brainDir, DOC_SECTIONS.architecture, "index.md"),
    initSectionIndexMd("High-level architecture", "Add macro-view docs here — how the major pieces fit together.", "architecture")
  );
  writeInitFile(created, root, path.join(evalsDir(brainDir), "index.md"), initEvalsIndexMd());
  writeInitFile(created, root, verifyConfigPath(brainDir), initVerifyJson());
  writeInitFile(created, root, path.join(brainDir, "CHANGELOG.md"), initChangelogMd(today));

  const explicitAgentsChoice =
    flags["agents-md"] !== undefined || flags["no-agents-md"] !== undefined || flags.yes !== undefined;
  const interactive = !explicitAgentsChoice && !!process.stdin.isTTY && !!process.stderr.isTTY;
  const writeAgents = interactive
    ? await promptYesNo("Write AGENTS.md pointer + CLAUDE.md symlink? [y/N] ")
    : !!flags["agents-md"];

  if (writeAgents) {
    const agentsPath = path.join(root, "AGENTS.md");
    const claudePath = path.join(root, "CLAUDE.md");
    if (pathExistsAny(agentsPath)) {
      process.stderr.write(`warning: ${collapseHome(agentsPath)} already exists — leaving it untouched\n`);
      skipped.push(`${path.relative(root, agentsPath)} (already exists)`);
    } else {
      writeInitFile(created, root, agentsPath, initAgentsMd());
    }
    if (pathExistsAny(claudePath)) {
      process.stderr.write(`warning: ${collapseHome(claudePath)} already exists — leaving it untouched\n`);
      skipped.push(`${path.relative(root, claudePath)} (already exists)`);
    } else {
      fs.symlinkSync("AGENTS.md", claudePath);
      created.push(`${path.relative(root, claudePath)} -> AGENTS.md`);
    }
  }

  const verifyRel = path.relative(root, verifyConfigPath(brainDir));
  const lines = [kv("root", collapseHome(root)), ...toonList("created", created)];
  if (skipped.length) lines.push(...toonList("skipped", skipped));
  lines.push(
    ...toonList("help", [
      `Edit ${verifyRel} with your real typecheck/test/build commands`,
      "Run `brain setup --app claude` to install the session-start context hook",
      "Run `brain playbook start` to begin the first task",
      "Run `brain check` to verify the new harness",
    ])
  );
  print(lines);
}

// ---------------------------------------------------------------------------
// Setup — session hook installation (explicit opt-in, idempotent, path repair)
// ---------------------------------------------------------------------------

function resolveHookCommand(repoRoot) {
  // Prefer a $CLAUDE_PROJECT_DIR-relative path when installed as a local
  // node_modules dependency: this is committed into settings.json, so it must
  // work for every teammate/CI that installs via the lockfile — not just the
  // operator running `setup`, whose machine may also happen to have a global
  // link that wouldn't exist for anyone else.
  const localBin = path.join(repoRoot, "node_modules", ".bin", "brain");
  if (fs.existsSync(localBin) && fs.realpathSync(localBin) === fs.realpathSync(BIN_PATH)) {
    return `"$CLAUDE_PROJECT_DIR/node_modules/.bin/brain" context`;
  }
  // Next, a PATH-verified binary name when it resolves to this executable.
  try {
    const onPath = execFileSync("which", ["brain"], { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
    if (onPath && fs.realpathSync(onPath) === fs.realpathSync(BIN_PATH)) return "brain context";
  } catch {}
  return `"${BIN_PATH}" context`;
}

function readJsonSafe(p) {
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    opError(`${path.relative(process.cwd(), p)} is not valid JSON (${e.message})`, [
      "Fix or remove the file, then re-run `brain setup`",
    ]);
  }
}

const isBrainHookCommand = (cmd) =>
  typeof cmd === "string" && /(^|[/\\"'\s])brain(\.js)?"? context$/.test(cmd);

function setupClaude(repoRoot, command) {
  const settingsPath = path.join(repoRoot, ".claude", "settings.json");
  const settings = readJsonSafe(settingsPath);
  settings.hooks = settings.hooks || {};
  settings.hooks.SessionStart = settings.hooks.SessionStart || [];

  for (const matcher of settings.hooks.SessionStart) {
    for (const hook of matcher.hooks || []) {
      if (isBrainHookCommand(hook.command)) {
        if (hook.command === command) return { path: settingsPath, action: "already installed (no-op)" };
        hook.command = command;
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
        return { path: settingsPath, action: "path repaired" };
      }
    }
  }
  settings.hooks.SessionStart.push({ hooks: [{ type: "command", command }] });
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return { path: settingsPath, action: "installed" };
}

function setupCodex(repoRoot, command) {
  const hooksPath = path.join(repoRoot, ".codex", "hooks.json");
  const config = readJsonSafe(hooksPath);
  config.hooks = config.hooks || [];
  for (const hook of config.hooks) {
    if (hook.event === "SessionStart" && isBrainHookCommand(hook.command)) {
      if (hook.command === command)
        return { path: hooksPath, action: "already installed (no-op)", note: "ensure [features].hooks = true in codex config.toml" };
      hook.command = command;
      fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
      fs.writeFileSync(hooksPath, JSON.stringify(config, null, 2) + "\n");
      return { path: hooksPath, action: "path repaired", note: "ensure [features].hooks = true in codex config.toml" };
    }
  }
  config.hooks.push({ event: "SessionStart", type: "command", command });
  fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
  fs.writeFileSync(hooksPath, JSON.stringify(config, null, 2) + "\n");
  return { path: hooksPath, action: "installed", note: "ensure [features].hooks = true in codex config.toml" };
}

function setupOpencode(command) {
  const pluginDir = path.join(os.homedir(), ".config", "opencode", "plugins");
  const pluginPath = path.join(pluginDir, "brain-context.js");
  const content = `// Managed by \`brain setup --app opencode\`. Injects .brain session context.
import { execSync } from "node:child_process";

export const BrainContext = async ({ directory }) => ({
  "chat.system": async (_input, output) => {
    try {
      const ctx = execSync(${JSON.stringify(command)}, { cwd: directory, stdio: ["ignore", "pipe", "ignore"] })
        .toString().trim();
      if (ctx) output.system.push("Project .brain state:\\n" + ctx);
    } catch {} // not a brain repo — inject nothing
  },
});
`;
  if (fs.existsSync(pluginPath) && fs.readFileSync(pluginPath, "utf8") === content)
    return { path: pluginPath, action: "already installed (no-op)" };
  const existed = fs.existsSync(pluginPath);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(pluginPath, content);
  return { path: pluginPath, action: existed ? "path repaired" : "installed" };
}

function setupCopilot(command) {
  const hooksPath = path.join(os.homedir(), ".config", "github-copilot", "hooks.json");
  const config = readJsonSafe(hooksPath);
  config.hooks = config.hooks || [];
  for (const hook of config.hooks) {
    if (hook.event === "SessionStart" && isBrainHookCommand(hook.command)) {
      if (hook.command === command) return { path: hooksPath, action: "already installed (no-op)" };
      hook.command = command;
      fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
      fs.writeFileSync(hooksPath, JSON.stringify(config, null, 2) + "\n");
      return { path: hooksPath, action: "path repaired" };
    }
  }
  config.hooks.push({ event: "SessionStart", type: "command", command });
  fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
  fs.writeFileSync(hooksPath, JSON.stringify(config, null, 2) + "\n");
  return { path: hooksPath, action: "installed", note: "best-effort: Copilot CLI hook support/shape may vary by version" };
}

function cmdSetup(argv) {
  const spec = {
    "--app": { value: true, desc: "target app: claude | codex | opencode | copilot | all (required)" },
  };
  const { flags } = parseArgs(argv, spec, "setup");
  if (flags.help)
    helpBlock("setup", "Install a SessionStart hook that injects `brain context` into new agent sessions", spec, [
      "brain setup --app claude",
      "brain setup --app all",
    ]);
  const APPS = ["claude", "codex", "opencode", "copilot", "all"];
  if (!flags.app) usageError("--app is required", [`brain setup --app <${APPS.join("|")}>`]);
  if (!APPS.includes(flags.app))
    usageError(`invalid --app "${flags.app}"`, [`valid apps: ${APPS.join(", ")}`]);

  const brain = findBrain(flags.brain);
  const repoRoot = path.dirname(brain);
  const command = resolveHookCommand(repoRoot);
  const targets = flags.app === "all" ? ["claude", "codex", "opencode", "copilot"] : [flags.app];

  const rows = [];
  for (const app of targets) {
    const r =
      app === "claude" ? setupClaude(repoRoot, command)
      : app === "codex" ? setupCodex(repoRoot, command)
      : app === "copilot" ? setupCopilot(command)
      : setupOpencode(command);
    rows.push({ app, action: r.action, file: collapseHome(r.path), note: r.note || "" });
  }
  print([
    kv("hook-command", command),
    ...toonTable("setup", rows, ["app", "action", "file", "note"]),
    ...toonList("help", [
      "New sessions in this repo now start with compact brain context",
      "Run `brain skill --write` to also ship an installable agent skill (on-demand, no per-session cost)",
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Skill — installable SKILL.md generated from the same guidance the CLI prints
// ---------------------------------------------------------------------------

function skillContent() {
  // Static by design: strips live state, uses npx-runnable command forms.
  // Description is YAML double-quoted: it contains a mid-string ": " (colon
  // + space), which is invalid in an unquoted YAML plain scalar — some
  // frontmatter parsers (e.g. the `npx skills` installer) silently drop the
  // whole skill on a parse failure rather than erroring loudly.
  const description =
    "Query and update a repo's .brain agent harness (features, progress checkpoints, rules, recipes, run notes, human plan reviews). Use when working in a repo with a .brain directory — before starting a task (read state), during (search docs/rules), and after (checkpoint progress, flip feature status). ALSO use whenever the user asks for a plan, proposal, design, or review of an approach: write the plan as an HTML artifact and open an interactive brain review session in their browser instead of printing the plan in chat.";
  return `---
name: brain
description: ${JSON.stringify(description)}
---

# brain — .brain harness CLI

All commands print TOON-structured output. Run from anywhere inside the repo; the CLI walks up to find \`.brain/\`. If \`brain\` is not on PATH, use \`npx -y brain-axi <command>\`.

## Playbooks (\`brain playbook <id>\`)

Eight standing playbooks — each a full text standard printed by \`brain playbook <id>\`, meant to be followed step by step while doing the thing it names:

- \`start\` — starting any non-trivial task — frame it, read the brain, baseline, open state
- \`plan\` — writing any plan/proposal/design artifact for human review
- \`product\` — any plan for user-facing work — the product case before the technical one
- \`ux\` — any plan that adds or changes a screen — wireframes, screen states, user flows
- \`ai\` — any work involving prompts, models, or agents — evals, golden sets, regression gates, topology
- \`verify\` — verifying a user-visible feature works — browser walk with screenshot evidence
- \`execute\` — implementing an approved plan / working a feature to shipped
- \`done\` — before declaring any task complete — full verify, harness invariants, coherence

Run \`brain playbook\` for the live id/use_when index; \`brain playbook <id>\` for the full text. Referenced inline below at the point each one applies.

## No \`.brain/\` yet?

- \`npx -y brain-axi init\` — scaffolds a minimal .brain skeleton (HARNESS.md,
  feature_list.json, progress.md with a first checkpoint, verify.json, doc
  section stubs) into the current repo, terse and placeholder-marked for the
  project to fill in. Errors (exit 1) if \`.brain/\` already exists — never
  clobbers. \`--agents-md\` also writes an AGENTS.md pointer + CLAUDE.md
  symlink; interactively prompts for that choice only in a real terminal,
  else skips it by default.

## Orient (start of session)

- \`brain\` — dashboard: feature counts, in-progress feature, last checkpoint
- \`brain progress\` — latest session checkpoint in full (branch, next step)
- \`brain features\` — feature list with status
- \`npx -y brain-axi playbook start\` — starting any non-trivial task: read brain
  state, frame intent/scope/affected feature(s), read the relevant docs, check
  scope policy (\`brain check\`), establish a baseline (\`brain verify --stage
  baseline\`), then claim + open state — before writing a line of code

## Look things up (during work)

- \`brain docs\` — doc sections; \`brain docs rules\` — list; \`brain docs view rules/errors\` — read
- \`brain search "<query>"\` — find text anywhere in the brain (\`--section rules\` to narrow)
- \`brain features view <slug>\` — tracker fields + feature doc
- \`brain runs view <name>\` — deep per-task state (baselines, dead ends, decisions)
- \`npx -y brain-axi playbook plan\` — the plan artifact standard (structure, decision cards, diagrams)
- \`npx -y brain-axi playbook product\` — the product case: problem + evidence, user + job, success metric, non-goals, scope tiers, prior art, product decision cards (plan sections 3 and 7)
- \`npx -y brain-axi playbook ux\` — wireframes, screen-state matrix, user-journey flow, layout variant cards (plan section 6)

## Record state (end of task / checkpoint)

- \`brain progress add --summary "..." --next "..."\` — append a session checkpoint
- \`brain features set-status <slug> --status <planned|in-progress|shipped|blocked|cut>\` — flip feature state (enforces one-in-progress policy; \`--status shipped\` requires \`--evidence\` **and passes the same preflight as \`brain ship\` — it refuses and writes nothing if any check would fail**. Transitions *out* of a state are never gated, so a broken record stays repairable)
- \`brain check\` — deterministic harness invariants (feature-list **schema** validity — duplicate ids/slugs, unknown status, shipped-without-evidence all fail — one-in-progress per declared policy, doc paths, dependency refs, \`features/index.md\` agreeing with the tracker, plan/review file integrity, verification docs having a **readable** verdict with resolvable image links, verify.json shape when present); exit 1 on any failure, CI-usable
- \`brain features index [--write]\` — GENERATE the \`features/index.md\` status table from \`feature_list.json\` (bounded by \`<!-- brain:features-table -->\` markers so surrounding prose survives). Hand-maintaining that mirror is how a tracker and its human-facing index end up disagreeing
- \`brain receipt <feature> [--date <d>] [--verified-by <who>] [--allow-dirty]\` — stamp a commit-bound provenance receipt into a verification doc, written BY THE TOOL: HEAD at stamp time plus the actual gate results for that feature from \`runs/gates.jsonl\`. Refuses on a dirty tree (a receipt naming HEAD while the tree differs describes code in no commit) and refuses to stamp a doc whose verdict is unreadable — a hand-written receipt is a claim about provenance, not provenance
- \`brain check --strict\` — adds two: every \`shipped\` feature must have a verification doc whose verdict parses to PASS, **and** that doc must carry a \`brain:verification\` receipt naming a commit that is an ancestor of HEAD. Opt-in here so brains predating the invariants do not go red on upgrade; \`brain ship\` and \`set-status --status shipped\` **always** enforce both, since shipping is the moment the claim is made
- **Verification receipts** — a verdict with no commit is unfalsifiable (the doc is mutable and date-named, so "it passed" could describe any tree that ever existed). Put this block in every verification doc; it renders as nothing:
  \`\`\`
  <!-- brain:verification
  commit: <short sha, e.g. \`git rev-parse --short HEAD\`>
  verified_by: feature-verifier
  commands: bun run test (exit 0); bun run typecheck (exit 0)
  -->
  \`\`\`
- \`brain metrics [--limit N]\` — gate effectiveness over \`runs/gates.jsonl\` (written by every \`brain verify\`): first-pass rate, per-check failure counts, p50/p95 duration. It also names any check that has never failed in 3+ runs — a gate with no failing fixture is a claim, not a check. Without this the harness can only prove it is *intact*, never that it *works*
- \`brain init --state-only --dir <repo> --yes\` — for a repo CLONED from a template: wipes inherited state (\`features/\`, \`runs/\`, \`plans/\`, \`screenshots/\`, \`evals/\`) and keeps the docs (\`rules/\`, \`recipes/\`, \`codebase/\`, \`high-level-architecture/\`, \`HARNESS.md\`, \`verify.json\`) — the clone inherits the stack along with the code, but not another project's history. Bare \`brain init\` still refuses a non-empty \`.brain\`
- \`brain\` (home) shows an open \`sessions[...]\` table whenever a review session isn't ended yet

## Verify — run declared project checks (\`.brain/verify.json\`)

\`.brain/verify.json\` registers the project's own checks (typecheck, tests,
lint, e2e, ...) so an agent runs the SAME commands the project actually uses
instead of guessing. Shape:

\`\`\`json
{"version":1,"checks":[{"name":"typecheck","run":"bun run typecheck","stages":["baseline","verify"]}]}
\`\`\`

Each check: \`name\` (unique), \`run\` (shell command), \`stages\` (non-empty subset
of \`bootstrap|baseline|verify\`), optional \`timeout\` in seconds (default 300).

- \`brain verify\` — runs every check whose \`stages\` includes \`verify\` (the
  default), sequentially and in registry order (checks may share
  caches/DBs — never parallelized), from the repo root. Reports
  \`results[]{check,status,exit,seconds}\` plus a \`tail_<name>:\` block (last 15
  lines of combined output) for every non-pass check. Exits 1 if any executed
  check fails or times out; exits 0 (no-op) if zero checks match the stage.
- \`brain verify --stage bootstrap|baseline|verify\` — run a different stage.
- \`brain verify --stage evals\` — the AI gate: runs the eval suites in
  \`.brain/evals/\`, not verify.json checks (\`evals\` is NOT a legal stage inside
  verify.json). Opt-in only — see the AI-work section below.
- \`brain verify --only <name>\` — run just one check by name; wins over \`--stage\`.
- \`brain verify --feature <slug>\` — also appends the results verbatim as a
  run-note step under that feature (same write path as \`runs append\`).
- Missing or malformed \`.brain/verify.json\` exits 1 with a copy-pasteable
  registry snippet in the \`help:\` lines — self-serve, no need to ask.

## Feature-centric \`.brain/\` layout

Everything about a feature lives in its own folder. Every reader below merges
this layout with the legacy flat one, so older brains keep working:

\`\`\`
.brain/features/feature_list.json          tracker (doc paths point at features/<slug>/<slug>.md)
.brain/features/<slug>/
  <slug>.md                                feature doc
  screenshots/NN-<step>.png                golden path (01-, 02-, ...); error paths E1-, E2-, ...
  verifications/<YYYY-MM-DD>.md            browser-walk verdict docs (PASS/FAIL/BLOCKED evidence)
  runs/<YYYY-MM-DD>-<task>.md              per-feature run notes
  plans/<plan-slug>/                       review plans scoped to this feature
.brain/runs/progress.md                    stays global — rolling session cursor
.brain/plans/<plan-slug>/                  fallback pool: plans not tied to a feature
\`\`\`

- \`npx -y brain-axi shots add <img> --feature <slug> --step 01-signin\` — primary
  form; lands at \`.brain/features/<slug>/screenshots/01-signin.png\`. \`--scope\`
  still works as a legacy alias.
- Capturing the screenshots is YOUR job, not the CLI's (brain-axi ships no
  browser automation): scaffold a throwaway Playwright script per
  \`npx -y brain-axi playbook verify\` (project-pinned playwright, or
  \`npx -y playwright install chromium\`), screenshot each step, add via
  \`shots add\`, delete the script.
- \`brain shots [<feature>]\` — merged list (per-feature + legacy); shows an
  open-notes count per shot once any exist.
- \`npx -y brain-axi shots notes <feature>\` — list reviewer pin+note
  annotations dropped on a feature's screenshots from the \`watch\` carousel
  (pin, note, timestamp, open/superseded, sent). Re-capturing a shot via
  \`shots add\` supersedes its open annotations. The reviewer accumulates pins
  freely (delete/adjust) and only hands a batch off with an explicit "Send to
  Claude" click in the carousel — an unsent pin (sent: no) is still being
  drafted, not yet ready to act on; only pins with a sent date are a settled
  ask.
- \`brain review <plan.html> --feature <slug>\` — binds the plan under that
  feature's \`plans/\` dir instead of the legacy fallback pool.

## Verifications — proof a feature actually works

- \`npx -y brain-axi playbook verify\` — the verification-doc standard: browser
  walk (golden path + one error path), screenshot naming, the jsErrors/
  networkErrors console policy, and how to persist the evidence.
- \`brain verifications [<feature>]\` — list verdict docs (feature, date, verdict).
- \`brain verifications view <feature> <date>\` — read one in full.

After implementing and testing a user-visible feature, produce a verification
doc at \`.brain/features/<slug>/verifications/<date>.md\` following
\`brain playbook verify\` — this is how "it works" becomes checkable evidence
instead of a claim.

## Execution loop — implementing an approved plan / working a feature to shipped

Run \`npx -y brain-axi playbook execute\` and follow it. Short version: \`features
set-status <slug> --status in-progress\` → per step \`runs append <slug> --step
"..." --observed "..."\` (verbatim command output, not a paraphrase) → \`shots add
--feature <slug> --step NN-name\` on every visual test, pass AND fail → a
verification doc per \`playbook verify\` → \`brain ship <slug> --evidence "..."\`
(requires evidence; no-ops if already shipped; **preflights \`brain check\`
against the projected state and refuses the ship if anything would fail —
nothing is written, the feature keeps its previous status, exit 1**; on pass it
writes atomically, warns — does not block — on zero screenshots, and
checkpoints). \`runs/progress.md\` stays a rolling cursor;
\`features/<slug>/runs/*.md\` is the deep, verbatim record.

- \`npx -y brain-axi watch <feature>\` — opens the live execution dashboard in
  the browser (feature status, harness health, checkpoints, run-step logs,
  verification verdicts, screenshots, PR state). Run it UNPROMPTED as the first
  act of execution, right after flipping the feature in-progress — the human
  should never have to ask to see progress. Infer the slug; never ask for it:
  the plan's bound feature (\`brain plans view <plan-slug>\`), else the single
  in-progress feature (\`brain features\`), else the slug you are about to flip.
  It live-updates as the commands above write state.
- After opening a PR, record it: \`npx -y brain-axi pr <slug> --url <pr-url>\`
  — this is the dashboard's terminal state (approval → execution → PR).

## AI work — prompts, models, agents

Run \`npx -y brain-axi playbook ai\` and follow it whenever the work involves a
prompt, a model call, a chain, retrieval, or an agent — it is additive to
start/execute/done, not a replacement. Short version: write the prompt contract
(job, inputs, output shape, known failure modes, model + settings pin) → build a
golden set in \`.brain/evals/<suite>/\` (min ~20 cases, real before synthetic, four
coverage bands — typical / edge / adversarial / refusal-correct, a held-out slice
you never tune against) → score with the cheapest kind that discriminates
(deterministic assertions before rubric+judge before human) → baseline, change ONE
thing, re-run, compare per-case → record the real numbers via \`brain runs append\`
and carry the delta into \`brain progress add\`.

Non-negotiables: every bug you fix becomes a frozen regression case in the same
session; a failing frozen case blocks the change no matter what the aggregate did;
a model/settings change is a prompt change (re-run the suite); prompts and eval
outputs get reviewed by a human, and unreviewed feedback blocks "done". Plans for
AI work carry section 16 of \`playbook plan\` (prompt contract, eval plan + golden
set, regression gate, agent topology).

Suites live in \`.brain/evals/<suite>/\` (\`suite.json\` + \`cases.jsonl\` + committed
run history). Commands:

- \`brain evals\` — every suite: cases, frozen count, last run, score, state
  (\`never-run\` | \`stale\` | \`regressed\` | \`ok\`). \`stale\` means a prompt the suite
  points at changed after the last run — the number on screen no longer describes
  the prompt on disk.
- \`brain evals view <suite>\` — config, coverage by origin/tag, thresholds, last
  run + delta + cost, failing case ids. \`brain evals cases <suite>\`
  (\`--frozen\`, \`--origin\`, \`--tag\`) reads the golden set; \`brain evals runs
  <suite>\` is the history.
- \`brain evals run <suite>\` — runs the suite's declared runner (a shell command
  in \`suite.json\`; brain never calls a model itself), records the run, applies the
  gate, exits 1 when it fails. \`--dry-run\` to skip recording.
- \`brain evals record <suite> --from <file> [--adapter promptfoo]\` — record a run
  produced elsewhere (promptfoo output, a python harness, an agent-scored pass).
  Runner/adapter contract: one JSON envelope,
  \`{"cases":[{"id":"...","output":"...","pass":true,"score":1}],"usage":{...}}\`.
- \`brain evals golden add <suite> --id <id> --input "..." --frozen\` — add a case;
  \`brain evals golden freeze <suite> <case-id>\` — flip an existing case to frozen.
  This is the move right after fixing an AI bug, in the same session.
- \`brain verify --stage evals\` — runs every suite through the gate. Opt-in by
  design: it never rides along on an ordinary \`brain verify\`, because model calls
  cost money and time.
- \`brain progress add --eval <suite> --summary "..."\` — stamps the checkpoint with
  the suite's real last-run score and delta, read from the run record (never a
  number you typed from memory).

## Before declaring any task complete

Run \`npx -y brain-axi playbook done\` and follow it before saying a task is
finished. Short version: full \`brain verify\` (green, or fix and \`--only
<name>\`) → feature verification for user-visible work (\`playbook verify\`,
not duplicated here) → \`brain check\` (harness invariants) → brain coherence
(every changed path's owning doc updated, or flagged) → close state
(\`runs append\`, \`progress add\`, \`brain ship <slug> --evidence "..."\` if the
feature itself is done). Anything unmet → say what's blocking, don't declare
done.

## Plan review (human-in-the-loop) — the DEFAULT for plans and approvals

When the user asks for a plan, proposal, design, or a review of an approach, do NOT
print the plan in chat and do NOT stop after writing a markdown file. Run this flow,
in order, in the current turn:

1. **Read the brain first** — \`brain progress\`, \`brain features\`, \`brain plans\`,
   \`brain timeline\`. Weave what you find into the plan (cite prior plans, decisions,
   in-progress feature, relevant rules).
2. **Run \`npx -y brain-axi playbook plan\` and follow it** to write the plan as ONE
   standalone HTML file (inline CSS, system fonts, no build step — it must render
   opened directly). The playbook covers the 17-section structure (0-16), decision cards,
   and diagram options (a CDN-based Mermaid snippet that degrades to readable text
   offline, or hand-rolled inline SVG for zero network dependency). Any path works;
   \`<repo>/plans/<topic>.html\` is a good default.
   Four of those sections are conditional, and each names the playbook that owns it —
   read that playbook BEFORE writing the section, not after: sections 3 + 7
   (product brief, product decisions) fire on any user-facing change →
   \`playbook product\`; section 6 (UI mockups + UX flows) fires when a screen changes →
   \`playbook ux\`; section 16 (AI addendum) fires on prompts/models/agents →
   \`playbook ai\`. Skip a conditional section when it does not apply.
3. **\`npx -y brain-axi review <plan.html>\`** — this pops the review UI in the user's
   browser. The UI shows your plan beside brain memory panels (past plans, timeline,
   screenshots), so the human reviews with full context.
4. **Immediately run \`npx -y brain-axi review poll <plan.html>\` and wait for it in the
   foreground of this same turn.** It blocks until the human annotates and clicks Send —
   that is the point. Do not background-and-forget it, do not skip it, do not end your
   turn while it waits. If it gets interrupted or times out, re-run the same command:
   feedback is never lost.
5. When the poll returns prompts, apply each requested change to the SAME html file
   (the browser hot-reloads it), then
   \`npx -y brain-axi review poll <plan.html> --agent-reply "what you changed"\`
   and wait again. Each prompt carries \`line\` + \`text\` anchors (server-resolved
   against the artifact's current content) — apply edits with targeted reads
   (offset/limit) and anchored replacements; do NOT re-read the whole artifact
   just to find what a prompt refers to.
6. Repeat step 5 until the plan is approved or the session ends.

Rules:

- If a poll response shows \`ended_by: user\` (or \`next_step\` says the user ended it): **stop polling, do not reopen the browser**, apply any remaining feedback, and report the outcome in the conversation. Only reopen with \`review <plan.html> --reopen\` if the user explicitly asks to resume.
- If a poll response carries \`layout_warnings\`, fix any \`severity: error\` entry and wait for the next poll to confirm a clean audit; if the SAME warning comes back \`persistent: true\`, proceed and mention it to the human instead of looping.
- A poll's DOM snapshot is a compact outline, not the raw page — it prints as \`snapshot_chars: N\` by default; pass \`--snapshot\` to see the full outline block only when you actually need it.
- \`npx -y brain-axi review end <plan.html>\` — end the session yourself once the plan is fully approved
- \`npx -y brain-axi shots add <img> --feature <slug> --step <NN-name>\` — attach a screenshot to a feature (\`--scope <plan-or-feature>\` is the legacy form)
- \`npx -y brain-axi plans\` / \`plans view <slug>\` — see past plan artifacts and their review rounds. Each round prints a \`snapshot:\` path (\`plans/<slug>/vN.html\`) — the FROZEN copy of the artifact as it stood at that round. A snapshot is written for every round, so the newest one is NOT automatically the approved one: the approved snapshot is the one for the round that ended the review (\`ended by\` in the round header). \`plans view\` names it for you in its \`help:\` line, and says so explicitly when no round has ended yet. When verifying a feature whose plan carried wireframes, compare the shipped UI against that approved snapshot, never against the live artifact path (the agent has been editing it); record each difference in the verification doc's mockup-reconciliation table per \`playbook verify\` 5b.
- \`npx -y brain-axi timeline\` — merged history across checkpoints, run notes, plan reviews, and verifications

## Install & session hooks (run once per repo)

- \`brain setup --app claude|codex|opencode\` — installs a SessionStart hook so the
  agent gets brain context automatically at the start of every session.
  Idempotent: re-running repairs stale paths and JSON-merges into existing
  settings without clobbering them.
- \`brain context\` — what that hook runs: a compact orientation block (features,
  latest checkpoint, open sessions). Silent no-op outside a repo with a
  \`.brain/\`, so it is safe to wire unconditionally.
- \`brain skill --write\` — regenerate this skill file after changing the CLI;
  \`brain skill --check\` exits 1 when it has drifted (wire it into CI, or into
  \`.brain/verify.json\` as a check).

Every command supports \`--help\`. Errors print an \`error:\` line plus a \`help:\` line with the corrected command.
`;
}

function cmdSkill(argv) {
  const spec = {
    "--write": { value: false, desc: "write .claude/skills/brain/SKILL.md at the repo root" },
    "--check": { value: false, desc: "exit 1 if the committed skill file is stale (for CI)" },
  };
  const { flags } = parseArgs(argv, spec, "skill");
  if (flags.help)
    helpBlock("skill", "Print, write, or check the installable agent skill for this CLI", spec,
      ["brain skill", "brain skill --write", "brain skill --check"]);
  const content = skillContent();
  if (!flags.write && !flags.check) {
    process.stdout.write(content);
    return;
  }
  const brain = findBrain(flags.brain);
  const skillPath = path.join(path.dirname(brain), ".claude", "skills", "brain", "SKILL.md");
  if (flags.check) {
    if (fs.existsSync(skillPath) && fs.readFileSync(skillPath, "utf8") === content) {
      print([`skill: ${path.relative(process.cwd(), skillPath)} is up to date`]);
      return;
    }
    print([
      `error: ${path.relative(process.cwd(), skillPath)} is stale or missing`,
      ...toonList("help", ["Run `brain skill --write` to regenerate it"]),
    ]);
    process.exit(1);
  }
  const existed = fs.existsSync(skillPath) && fs.readFileSync(skillPath, "utf8") === content;
  if (existed) {
    print([`skill: ${path.relative(process.cwd(), skillPath)} already up to date (no-op)`]);
    return;
  }
  fs.mkdirSync(path.dirname(skillPath), { recursive: true });
  fs.writeFileSync(skillPath, content);
  print([
    "skill:",
    kv("file", path.relative(process.cwd(), skillPath), 2),
    kv("action", "written", 2),
    ...toonList("help", ["Install into an agent with: npx skills add <owner>/<repo> --skill brain"]),
  ]);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const COMMANDS = {
  init: cmdInit,
  features: cmdFeatures,
  progress: cmdProgress,
  runs: cmdRuns,
  docs: cmdDocs,
  evals: cmdEvals,
  search: cmdSearch,
  context: cmdContext,
  setup: cmdSetup,
  skill: cmdSkill,
  review: cmdReview,
  plans: cmdPlans,
  shots: cmdShots,
  verifications: cmdVerifications,
  timeline: cmdTimeline,
  playbook: cmdPlaybook,
  check: cmdCheck,
  verify: cmdVerify,
  metrics: cmdMetrics,
  receipt: cmdReceipt,
  ship: cmdShip,
  watch: cmdWatch,
  pr: cmdPr,
};

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0].startsWith("--")) {
    cmdHome(argv);
    return;
  }
  const cmd = COMMANDS[argv[0]];
  if (!cmd) {
    usageError(`unknown command \`${argv[0]}\``, [
      `valid commands: ${Object.keys(COMMANDS).join(", ")}`,
      "Run `brain` with no arguments for the live dashboard",
    ]);
  }
  const result = cmd(argv.slice(1));
  // A few review commands are async (they talk to the review server over
  // HTTP); catch rejections here so an unexpected failure still reports as a
  // structured error instead of an unhandled-rejection stack trace.
  if (result && typeof result.then === "function") {
    result.catch((e) => {
      opError(`unexpected error: ${e.message}`, ["Re-run the command; if this persists, check the review server log"]);
    });
  }
}

main();
