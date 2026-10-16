#!/usr/bin/env node
// brain — the AXI: a thin shell over lib/brain. Parse args, call one library
// function, print TOON with a `help:` list of next steps.
// stdout: TOON only. stderr: diagnostics only.
// Exit codes: 0 success (incl. no-ops), 1 operation error, 2 usage error.
//
// Only lib/brain touches brain.db. This file never reads .brain/ content and
// never imports node:sqlite: lib/brain is loaded with a dynamic import() AFTER
// the Node version gate, so the SessionStart hook (`brain context`) stays
// silent on Node < 24 instead of crashing on a missing builtin.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { kv, toonTable, toonList as toonListRaw } from "../lib/brain/toon.js";

const MIN_NODE = 24;
const NODE_MAJOR = Number(process.versions.node.split(".")[0]);
const BIN_PATH = fileURLToPath(import.meta.url);
const PKG_ROOT = path.dirname(path.dirname(BIN_PATH));
const SERVER_PATH = path.join(PKG_ROOT, "lib", "review", "server.js");
const OWN_VERSION = readOwnVersion();
const DESCRIPTION =
  "Query and update this repo's brain (.brain/brain.db): features, tasks, checkpoints, run notes, docs, plans, verifications, checks";
const REVIEW_DEFAULT_PORT = 4517;
const CONTEXT_CAP = 600; // bytes — printed on every session start
const BODY_LIMIT = 1200; // chars before a long field is truncated (escape: --full)
const CELL_LIMIT = 160; // chars per long table cell

let L; // lib/brain — loaded in main() after the Node gate

function readOwnVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")).version;
  } catch {
    return "0.0.0";
  }
}

// ---------------------------------------------------------------------------
// Output + errors
// ---------------------------------------------------------------------------

// A value as one shell word for a copy-pasteable hint: bare when safe.
// POSIX single quotes: nothing inside expands ($, backticks, \ stay literal).
const shellWord = (v) => (/^[\w./:@%+=,-]+$/.test(v) ? v : `'${String(v).replace(/'/g, "'\\''")}'`);
// A path as one shell word: relative to the cwd when inside it, else
// absolute — never a quoted `~/…`, which the shell would not expand.
const shellPath = (p) => {
  const r = path.relative(process.cwd(), p);
  return shellWord(r === "" ? "." : r.startsWith("..") || path.isAbsolute(r) ? p : r);
};

// ` --brain <dir>` when this invocation named one: every `brain …` command a
// help: list suggests carries it, so following a hint reaches the same brain
// (set by runLeaf once flags are parsed).
let hintBrain = "";
function withBrain(item) {
  if (!hintBrain || typeof item !== "string" || /(^|\s)--brain\b/.test(item)) return item;
  // `brain …` spans get it before their closing backtick; else a trailing
  // "Label: brain …" command gets it at the end.
  const spans = item.replace(/`(brain [^`]*)`/g, (_, cmd) => `\`${cmd}${hintBrain}\``);
  if (spans !== item) return spans;
  return /(?:^|: )brain [a-z]/.test(item) ? item + hintBrain : item;
}
const toonList = (name, items) => toonListRaw(name, name === "help" ? items.map(withBrain) : items);

function print(lines) {
  process.stdout.write(lines.join("\n") + "\n");
}

// print, resolved once stdout has handed the bytes to the OS (a slow pipe
// reader may leave them buffered in this process until then).
function printFlushed(lines) {
  return new Promise((resolve, reject) => process.stdout.write(lines.join("\n") + "\n", (e) => (e ? reject(e) : resolve())));
}

// A CLI-level failure (bad flags, missing args). Library failures arrive as
// BrainError; both carry { code, message, help[], exitCode }.
class CliError extends Error {
  constructor(code, message, help = [], exitCode = 2) {
    super(message);
    this.code = code;
    this.help = help;
    this.exitCode = exitCode;
  }
}
const usage = (message, help) => {
  throw new CliError("USAGE", message, help, 2);
};
const fail = (code, message, help) => {
  throw new CliError(code, message, help, 1);
};

function printError(e) {
  const help = e.help && e.help.length ? e.help : ["Run `brain --help` for the command list"];
  print([kv("error", e.message), kv("code", e.code), ...toonList("help", help)]);
  process.exitCode = e.exitCode;
}

const rel = (p) => {
  const r = path.relative(process.cwd(), p);
  return r === "" ? "." : r.startsWith("..") ? tilde(p) : r;
};
const tilde = (p) => {
  const home = os.homedir();
  return p === home || p.startsWith(home + path.sep) ? "~" + p.slice(home.length) : p;
};
const csv = (v) => (v === undefined ? [] : String(v).split(",").map((s) => s.trim()).filter(Boolean));
const clip = (s, n = CELL_LIMIT) => {
  if (s === null || s === undefined) return s;
  const chars = Array.from(String(s));
  return chars.length <= n ? String(s) : chars.slice(0, n - 1).join("") + "…";
};

function posInt(value, flag) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) usage(`invalid ${flag} "${value}" — a positive whole number`, [`${flag} takes e.g. 10`]);
  return n;
}

// Text from a file path, or stdin for "-".
function readInput(source, flag) {
  try {
    return fs.readFileSync(source === "-" ? 0 : path.resolve(source), "utf8");
  } catch (e) {
    return fail("NOT_FOUND", `cannot read ${flag} ${source}: ${e.code || e.message}`, [`Pass an existing file to ${flag}, or - for stdin`]);
  }
}

// A long text field as a `label: |` block, truncated unless --full.
function block(label, text, { full = false, limit = BODY_LIMIT, indent = 0 } = {}) {
  const pad = " ".repeat(indent);
  const s = String(text ?? "");
  const truncated = !full && s.length > limit;
  const lines = [`${pad}${label}: |`];
  for (const l of (truncated ? s.slice(0, limit) : s).split("\n")) lines.push(`${pad}  ${l}`);
  if (truncated) lines.push(`${pad}  ... (truncated, ${s.length} chars total)`);
  return { lines, truncated };
}

// Flat kv lines, or `name:` + nested kv lines, one per defined field.
const kvs = (o) => Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => kv(k, v));
const group = (name, o) => [`${name}:`, ...Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => kv(k, v, 2))];

// Append a `label: |` block per non-empty field; true when any was truncated.
function addBlocks(lines, fields, full) {
  let truncated = false;
  for (const [label, text] of fields) {
    if (!text) continue;
    const b = block(label, text, { full });
    lines.push(...b.lines);
    truncated ||= b.truncated;
  }
  return truncated;
}

const statsLine = (st) =>
  `${st.total} total (${Object.entries(st.by_status).filter(([, n]) => n).map(([s, n]) => `${n} ${s}`).join(", ") || "none"})`;

// ---------------------------------------------------------------------------
// Flag parsing — per-command specs; unknown flags are rejected (exit 2)
// ---------------------------------------------------------------------------

const GLOBAL_FLAGS = {
  "--help": { desc: "show help for this command" },
  "--brain": { value: true, desc: "path to the .brain directory (default: walk up from cwd; worktrees share the main checkout's)" },
};

function parseArgs(argv, spec, label) {
  const merged = { ...GLOBAL_FLAGS, ...spec };
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      pos.push(...argv.slice(i + 1)); // everything after -- is positional
      break;
    }
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq === -1 ? a : a.slice(0, eq);
    const def = merged[name];
    if (!def)
      usage(`unknown flag ${name} for \`brain ${label}\``, [
        `valid flags: ${Object.keys(merged).sort().join(", ")}`,
        `Run \`brain ${label} --help\` for usage`,
      ]);
    const key = name.slice(2);
    if (!def.value) {
      if (eq !== -1) usage(`flag ${name} does not take a value`, [`Run \`brain ${label} --help\` for usage`]);
      flags[key] = true;
      continue;
    }
    let v = eq !== -1 ? a.slice(eq + 1) : argv[++i];
    if (v === undefined) usage(`flag ${name} requires a value`, [`Run \`brain ${label} --help\` for usage`]);
    if (def.repeat) (flags[key] = flags[key] || []).push(v);
    else flags[key] = v;
  }
  return { flags, pos };
}

function helpLines(label, leaf) {
  const merged = { ...(leaf.spec || {}), ...GLOBAL_FLAGS };
  const lines = [kv("command", `brain ${label}`.trim()), kv("summary", leaf.summary)];
  if (leaf.args && leaf.args.length) lines.push(...toonList("args", leaf.args));
  lines.push(...toonList("flags", Object.entries(merged).map(([f, d]) => `${f}${d.value ? " <value>" : ""}${d.repeat ? " (repeatable)" : ""} — ${d.desc}`)));
  if (leaf.examples && leaf.examples.length) lines.push(...toonList("examples", leaf.examples));
  lines.push(...toonList("help", ["Run `brain --help` for every command"]));
  return lines;
}

// ---------------------------------------------------------------------------
// Commands — each leaf: { summary, args, spec, examples, min, max, run(ctx) }
// ---------------------------------------------------------------------------

const ARG = {
  feature: "<feature> — feature slug (see `brain features list`)",
  task: "<task> — task key, e.g. t1 (see `brain tasks list <feature>`)",
  file: "<html-file> — the plan artifact (HTML)",
};

// --- home + help -----------------------------------------------------------

function home(ctx) {
  const { db, brainDir } = ctx.brain();
  const st = L.features.stats(db);
  const last = L.progress.latest(db);
  const lines = [
    ...kvs({ bin: tilde(BIN_PATH), description: DESCRIPTION, brain: rel(brainDir), features: statsLine(st),
      "in-progress": st.in_progress || "none" }),
  ];
  if (last) {
    lines.push(kv("last-checkpoint", `${last.at.slice(0, 10)} — ${last.summary}`));
    if (last.next) lines.push(kv("next", last.next));
  }
  const sessions = L.plans.openSessions(db);
  if (sessions.length)
    lines.push(...toonTable("review-sessions", sessions.map((p) => ({ plan: p.slug, status: p.status, file: p.file_path })), ["plan", "status", "file"]));
  const help = [];
  if (st.in_progress) help.push(`Run \`brain features view ${st.in_progress}\` for the feature in flight`);
  else help.push("Run `brain features list` to pick the next feature");
  help.push(
    "Run `brain progress list` for recent checkpoints",
    'Run `brain search "<query>"` to find text anywhere in the brain',
    "Run `brain docs list` to browse rules, recipes and architecture docs",
    "Run `brain --help` for every command"
  );
  print([...lines, ...toonList("help", help)]);
}

function globalHelp() {
  print([
    ...kvs({ bin: tilde(BIN_PATH), description: DESCRIPTION, usage: "brain <command> [subcommand] [args] [flags]" }),
    ...toonTable("commands", Object.entries(COMMANDS).map(([name, c]) => ({ name, summary: c.summary })), ["name", "summary"]),
    ...toonList("flags", Object.entries(GLOBAL_FLAGS).map(([f, d]) => `${f}${d.value ? " <value>" : ""} — ${d.desc}`)),
    ...toonList("help", ["Run `brain <command> --help` for its subcommands and flags", "Run `brain` with no arguments for the live dashboard"]),
  ]);
}

// --- init / context / export / import ------------------------------------

const init = {
  summary: "Create .brain/brain.db (gitignored) and seed the first checkpoint",
  brain: false,
  examples: ["brain init", "brain init --brain path/to/repo/.brain"],
  run(ctx) {
    const loc = L.locate(process.cwd(), { brain: ctx.flags.brain });
    if (loc.mainUnknown) throw L.db.mainUnknownError(loc);
    const made = L.create(path.dirname(loc.brainDir), { brain: loc.brainDir });
    try {
      const cp = L.progress.add(made.db, {
        summary: "brain initialized",
        next: "declare real checks with `brain verify add`, then add the first feature with `brain features add`",
        root: loc.root, // the caller's checkout: a worktree records its own branch
      });
      print([
        ...group("init", { brain: rel(made.brainDir), db: rel(made.dbPath), branch: cp.branch,
          gitignore: `${rel(path.join(made.mainRoot, ".gitignore"))} covers brain.db*, export.toon, shots/`, checkpoint: cp.id }),
        ...toonList("help", [
          'Declare the project\'s real checks: brain verify add test --run "<command>" --stages baseline,verify',
          'Add the first feature: brain features add <slug> --name "..."',
          "Run `brain` to see the dashboard",
        ]),
      ]);
    } finally {
      L.close(made.db);
    }
  },
};

const context = {
  summary: `Compact session-start context (≤ ${CONTEXT_CAP} B); silent outside a brain — used by the plugin's SessionStart hook`,
  examples: ["brain context"],
  async run(ctx) {
    const { db, brainDir, mainRoot } = ctx.brain();
    const st = L.features.stats(db);
    const last = L.progress.latest(db);
    const brainPath = rel(brainDir);
    const head = [kv("brain", brainPath), kv("features", statsLine(st))];
    // Sent, still-open screenshot pins are the reviewer's settled asks.
    // Only sent, not-yet-re-verified pins can be open: drop the rest before
    // their shots are hashed (this runs on every session start).
    const latest = L.verifications.latestAt(db);
    const maybeOpen = (p) => p.sentAt && !((latest.get(p.feature) || "") > p.sentAt);
    const pins = sentOpenPins(db, await readPinsSafe(brainDir, null, mainRoot, maybeOpen));
    if (pins.length) {
      const feats = [...new Set(pins.map((p) => p.feature))];
      const first = [...feats[0]].length > 40 ? [...feats[0]].slice(0, 39).join("") + "…" : feats[0];
      const where = feats.length > 1 ? `${first} +${feats.length - 1} more` : first;
      head.push(kv("pins", `${pins.length} sent screenshot pin${pins.length > 1 ? "s" : ""} open (${where}) — act on them: brain verifications view ${feats.length === 1 && first === feats[0] ? first : "<feature>"}`));
    }
    const free = { "in-progress": st.in_progress || "none" };
    if (last) {
      free["last-checkpoint"] = `${last.at.slice(0, 10)} — ${last.summary}`;
      if (last.next) free.next = last.next;
    }
    const tail = [
      kv("skills", "use the brain-* skills (brain, brain-start, brain-plan, ...)"),
      ...toonList("help", ["Run `brain` for the dashboard, `brain progress list` for recent checkpoints"]),
    ];
    const render = () => [...head, ...Object.entries(free).map(([k, v]) => kv(k, v)), ...tail];
    const overBy = () => Buffer.byteLength(render().join("\n") + "\n") - CONTEXT_CAP;
    for (const key of ["next", "last-checkpoint", "in-progress"]) {
      const over = overBy();
      if (over <= 0 || !free[key]) continue;
      const chars = [...free[key]];
      if (chars.length <= 20) continue; // already at the floor: clipping would only add "…"
      free[key] = chars.slice(0, Math.max(20, chars.length - over - 8)).join("") + "…";
    }
    // Multi-byte text can keep it over (≥20 chars per field): drop the
    // optional lines, then shorten the pins line to its bare count.
    for (const key of ["next", "last-checkpoint"]) if (overBy() > 0) delete free[key];
    const pinAt = head.findIndex((l) => l.startsWith("pins: "));
    if (overBy() > 0 && pinAt !== -1) head[pinAt] = kv("pins", `${pins.length} sent open — brain verifications view <feature>`);
    // A very long brain path (deep worktree) still fits: keep its tail.
    const over = overBy();
    if (over > 0) {
      const chars = [...brainPath];
      head[0] = kv("brain", "…" + chars.slice(Math.min(chars.length - 1, over + 8)).join(""));
    }
    print(render());
  },
};

// Screenshot pins from the watch dashboard (review server's store). A pin is
// a settled ask only once "Send to Claude" stamped sentAt; unsent pins are
// drafts. A broken store never breaks the CLI: it reads as no pins.
async function readPinsSafe(brainDir, feature, mainRoot, filter) {
  try {
    return (await reviewModules()).readPins(brainDir, feature, { mainRoot, filter });
  } catch (e) {
    if (process.env.BRAIN_DEBUG) process.stderr.write(`brain: pins unreadable: ${e.message}\n`);
    return [];
  }
}
// Each sent pin's state: superseded (its shot file was replaced or removed),
// re-verified (a verification round was recorded after it was sent — the
// agent acted on it), else open — the reviewer's ask still stands.
function pinStates(db, pins) {
  const latest = L.verifications.latestAt(db);
  return pins.map((p) => ({ ...p, state: p.superseded ? "superseded" : (latest.get(p.feature) || "") > p.sentAt ? "re-verified" : "open" }));
}
const sentOpenPins = (db, pins) => pinStates(db, pins.filter((p) => p.sentAt)).filter((p) => p.state === "open");

const exportCmd = {
  summary: "Write a deterministic TOON dump of the whole brain (default .brain/export.toon, gitignored)",
  spec: {
    "--out": { value: true, desc: "file to write (default: .brain/export.toon)" },
    "--stdout": { desc: "print the raw dump to stdout instead (for piping; no help: list)" },
  },
  examples: ["brain export", "brain export --out backup.toon", "brain export --stdout > backup.toon"],
  run(ctx) {
    const { db, brainDir, dbPath } = ctx.brain();
    const dump = L.io.exportAll(db);
    if (ctx.flags.stdout) return void process.stdout.write(dump);
    const out = path.resolve(ctx.flags.out || path.join(brainDir, "export.toon"));
    // Never write the dump over the live database or its WAL/SHM (symlinks included).
    const real = (p) => {
      try {
        return fs.realpathSync(p);
      } catch {
        try {
          return path.join(fs.realpathSync(path.dirname(p)), path.basename(p));
        } catch {
          return p;
        }
      }
    };
    const sameFile = (a, b) => {
      try {
        const x = fs.statSync(a), y = fs.statSync(b);
        return x.dev === y.dev && x.ino === y.ino; // a hard link to the DB too
      } catch {
        return false;
      }
    };
    if (["", "-wal", "-shm"].some((s) => real(out) === real(dbPath + s) || sameFile(out, dbPath + s)))
      usage(`--out ${ctx.flags.out} is the live database; pick another file`, ["brain export --out backup.toon"]);
    // Write beside the destination, then rename: a failed or interrupted
    // write never truncates the backup already there.
    // (A symlinked --out keeps pointing at the file it names.)
    // The temp name is unpredictable and created exclusively ("wx" = O_EXCL,
    // which never follows a symlink planted at that name); a failure removes
    // only the file this call created.
    const dest = real(out);
    const tmpOut = path.join(path.dirname(dest), `.${path.basename(dest)}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`);
    // Replacing a backup keeps its permissions (a 0600 dump stays 0600).
    let keepMode = null;
    try {
      keepMode = fs.statSync(dest).mode & 0o7777;
    } catch {}
    let fd = null;
    let made = false;
    try {
      fd = fs.openSync(tmpOut, "wx", keepMode ?? 0o644);
      made = true;
      if (keepMode !== null) fs.fchmodSync(fd, keepMode); // exact, not umask-masked
      fs.writeFileSync(fd, dump);
      fs.closeSync(fd);
      fd = null;
      fs.renameSync(tmpOut, dest);
    } catch (e) {
      if (fd !== null) fs.closeSync(fd);
      if (made) fs.rmSync(tmpOut, { force: true });
      throw e;
    }
    const counts = L.io.TABLES.map((t) => ({ table: t, rows: (dump.match(new RegExp(`^${t}\\[(\\d+)\\]`, "m")) || [0, 0])[1] * 1 }));
    print([
      ...group("export", { file: rel(out), bytes: Buffer.byteLength(dump) }),
      ...toonTable("tables", counts.filter((c) => c.rows), ["table", "rows"], 2),
      ...toonList("help", [`Restore into a fresh brain: brain import ${shellPath(out)}`]),
    ]);
  },
};

const importCmd = {
  summary: "Load an export into an empty brain (creates brain.db when there is none)",
  brain: false,
  args: ["<file> — a `brain export` dump, or - for stdin"], min: 1, max: 1,
  examples: ["brain import backup.toon", "cat backup.toon | brain import -"],
  run(ctx) {
    const text = readInput(ctx.pos[0], "<file>");
    let b;
    let staging = null;
    try {
      b = L.openBrain(process.cwd(), { brain: ctx.flags.brain });
    } catch (e) {
      if (!L.isBrainError(e, "NO_DB")) throw e;
      // No brain.db yet: import into a PRIVATE staging DB and publish it with
      // an atomic link only on success. A failed import deletes only its own
      // staging dir — never a brain.db another process may be writing to.
      const loc = L.locate(process.cwd(), { brain: ctx.flags.brain });
      fs.mkdirSync(loc.brainDir, { recursive: true });
      staging = fs.mkdtempSync(path.join(loc.brainDir, ".import-"));
      const staged = path.join(staging, "brain.db");
      try {
        fs.closeSync(fs.openSync(staged, "wx"));
        b = { ...loc, staged, db: L.open(staged) };
      } catch (err) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw err;
      }
    }
    let res;
    try {
      res = L.io.importAll(b.db, text);
      if (staging) b.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); // every page in the main file before it is linked
    } catch (e) {
      L.close(b.db);
      if (staging) fs.rmSync(staging, { recursive: true, force: true });
      throw e;
    }
    L.close(b.db);
    if (staging) {
      try {
        // .gitignore first (as `init` does): brain.db never appears un-ignored.
        L.db.ensureGitignore(b.mainRoot, b.brainDir);
        // An exclusive link (an exclusive copy where links are unsupported):
        // BRAIN_EXISTS rather than replace a brain.db made meanwhile.
        L.db.publishExclusive(b.staged, b.dbPath);
      } catch (e) {
        if (!L.isBrainError(e, "BRAIN_EXISTS")) throw e;
        fail("BRAIN_EXISTS", `${rel(b.dbPath)} was created by another process during the import; it was left untouched`, [
          "Run `brain` to see its state",
          "To restore into it, it must be empty: move it aside, then `brain import <file>`",
        ]);
      } finally {
        fs.rmSync(staging, { recursive: true, force: true });
      }
    }
    const created = !!staging;
    print([
      ...group("import", { db: rel(b.dbPath), created, "format-version": res.version, schema: res.schema }),
      ...toonTable("tables", Object.entries(res.rows).filter(([, n]) => n).map(([table, rows]) => ({ table, rows })), ["table", "rows"], 2),
      ...toonList("help", ["Run `brain check` to confirm integrity", "Run `brain` for the dashboard"]),
    ]);
  },
};

// --- features ---------------------------------------------------------------

const features = {
  summary: "The feature tracker: list, view, add, set (status, pr, fields), ship",
  default: "list",
  subs: {
    list: {
      summary: "List features with status, open tasks and PR",
      spec: { "--status": { value: true, desc: "filter: planned|in-progress|shipped|blocked|cut" } },
      examples: ["brain features list", "brain features list --status in-progress"],
      run(ctx) {
        const { db } = ctx.brain();
        const rows = L.features.list(db, { status: ctx.flags.status });
        const st = L.features.stats(db);
        const help = rows.length
          ? ["Run `brain features view <slug>` for one feature's tasks, verdict and doc"]
          : ['Run `brain features add <slug> --name "..."` to add one'];
        if (st.in_progress) help.push(`Run \`brain tasks list ${st.in_progress}\` for the in-progress feature's tasks`);
        const table = rows.map((f) => ({ ...f, tasks: `${f.tasks_open} open / ${f.tasks_total}`, pr: f.pr_url }));
        print([kv("summary", statsLine(st)), ...toonTable("features", table, ["slug", "status", "name", "tasks", "pr"]), ...toonList("help", help)]);
      },
    },
    view: {
      summary: "One feature: fields, dependencies, tasks, latest verdict, feature doc",
      args: [ARG.feature], min: 1, max: 1,
      spec: { "--full": { desc: "do not truncate long fields" } },
      examples: ["brain features view axi-core", "brain features view axi-core --full"],
      run(ctx) {
        const { db } = ctx.brain();
        const f = L.features.get(db, ctx.pos[0]);
        const full = !!ctx.flags.full;
        const lines = kvs({ slug: f.slug, name: f.name, status: f.status, depends_on: f.depends_on.join(", ") || "none", pr: f.pr_url });
        let truncated = false;
        if (f.grandfathered) lines.push(kv("grandfathered", true));
        truncated = addBlocks(lines, [["description", f.description], ["evidence", f.evidence]], full) || truncated;
        lines.push(kv("verdict", f.verdict ? `${f.verdict.verdict} (round ${f.verdict.round}, ${f.verdict.commit ? f.verdict.commit.slice(0, 7) : "no commit"}${f.verdict.dirty ? ", dirty tree" : ""})` : "none"));
        lines.push(...toonTable("tasks", f.tasks, ["key", "status", "title", "claimed_by"]));
        if (f.doc) lines.push(kv("doc", `features/${f.slug}${f.doc.title ? ` — ${f.doc.title}` : ""}`));
        if (f.doc) truncated = addBlocks(lines, [["doc_body", f.doc.body]], full) || truncated;
        const help = [];
        if (truncated) help.push(`Run \`brain features view ${f.slug} --full\` for the complete text`);
        if (f.status === "planned" || f.status === "blocked") help.push(`Start it: brain features set ${f.slug} --status in-progress`);
        if (f.status === "in-progress") {
          help.push(f.tasks.length ? `Run \`brain tasks list ${f.slug}\` for ready tasks` : `Split it: brain tasks add ${f.slug} --title "..." --acceptance "..."`);
          help.push(`Ship it once a PASS verification exists: brain features ship ${f.slug} --evidence "..."`);
        }
        if (!f.doc) help.push(`Write its doc: brain docs set features ${f.slug} --from <file>`);
        print([...lines, ...toonList("help", help.length ? help : ["Run `brain features list`"])]);
      },
    },
    add: {
      summary: "Add a feature (status planned unless --status says otherwise)",
      args: ["<slug> — lowercase letters, digits, single hyphens"], min: 1, max: 1,
      spec: {
        "--name": { value: true, desc: "display name (required)" },
        "--description": { value: true, desc: "what it is and why" },
        "--depends-on": { value: true, desc: "comma-separated feature slugs" },
        "--status": { value: true, desc: "planned (default) | in-progress | blocked" },
      },
      examples: ['brain features add auth --name "Authentication" --description "..." --depends-on core'],
      run(ctx) {
        const { db } = ctx.brain(), { flags } = ctx;
        const { name, description = null, status = "planned" } = flags;
        const f = L.features.add(db, { slug: ctx.pos[0], name, description, dependsOn: csv(flags["depends-on"]), status });
        print([
          ...group("feature", { slug: f.slug, name: f.name, status: f.status, depends_on: f.depends_on.join(", ") || "none" }),
          ...toonList("help", [
            `Write its doc: brain docs set features ${f.slug} --from <file>`,
            `Split it into tasks: brain tasks add ${f.slug} --title "..." --acceptance "..."`,
            ...(f.status === "in-progress" ? [] : [`Start it: brain features set ${f.slug} --status in-progress`]),
          ]),
        ]);
      },
    },
    set: {
      summary: "Update a feature: --status (not shipped — use ship), --pr, --name, --description",
      args: [ARG.feature], min: 1, max: 1,
      spec: {
        "--status": { value: true, desc: "planned | in-progress | blocked | cut" },
        "--pr": { value: true, desc: "pull request URL (records the PR)" },
        "--name": { value: true, desc: "new display name" },
        "--description": { value: true, desc: "new description" },
      },
      examples: [
        "brain features set auth --status in-progress",
        "brain features set auth --pr https://github.com/o/r/pull/7",
      ],
      run(ctx) {
        const { db } = ctx.brain(), { flags } = ctx;
        const slug = ctx.pos[0];
        if (["status", "pr", "name", "description"].every((k) => flags[k] === undefined))
          usage("nothing to set", [`brain features set ${slug} --status in-progress|planned|blocked|cut`, `brain features set ${slug} --pr <url>`]);
        const r = L.features.set(db, slug, { status: flags.status, pr: flags.pr, name: flags.name, description: flags.description });
        const f = r.feature;
        const help = [];
        if (f.status === "in-progress") {
          help.push(`Checkpoint the start: brain progress add --feature ${f.slug} --summary "..." --next "..."`);
          help.push(`Log steps as you go: brain runs append ${f.slug} --step "..." --observed "..."`);
        }
        if (flags.pr) help.push(`Record the close-out: brain progress add --feature ${f.slug} --summary "PR opened: ${flags.pr}"`);
        if (!help.length) help.push(`Run \`brain features view ${f.slug}\``);
        print([
          ...group("feature", { slug: f.slug, status: f.status, previous: r.previous, pr: f.pr_url, changed: r.changed }),
          ...toonList("help", help),
        ]);
      },
    },
    ship: {
      summary: "Ship a feature: needs evidence, no open tasks and a PASS verification; writes a checkpoint",
      args: [ARG.feature], min: 1, max: 1,
      spec: { "--evidence": { value: true, desc: "what proves it works (required)" } },
      examples: ['brain features ship auth --evidence "verifier PASS round 2; node --test 120/120"'],
      run(ctx) {
        const { db, root } = ctx.brain();
        const r = L.features.ship(db, ctx.pos[0], { evidence: ctx.flags.evidence, root });
        const f = r.feature;
        print([
          ...group("ship", { outcome: r.outcome, slug: f.slug, status: f.status, previous: r.previous }),
          ...(r.checkpoint ? [kv("checkpoint", r.checkpoint.id, 2), kv("summary_clipped", r.checkpoint.clipped, 2)] : []),
          ...(r.warning ? [kv("warning", r.warning.message)] : []),
          ...toonList("help", [
            ...(r.warning ? r.warning.help : []),
            `Record the PR: brain features set ${f.slug} --pr <url>`,
            "Run `brain features list` to pick the next feature",
          ]),
        ]);
      },
    },
  },
};

// --- tasks --------------------------------------------------------------------

const tasks = {
  summary: "Units of work below a feature: list, view (the brief), add, claim, set",
  default: "list",
  subs: {
    list: {
      summary: "List a feature's tasks with readiness",
      args: [ARG.feature], min: 1, max: 1,
      examples: ["brain tasks list auth"],
      run(ctx) {
        const { db } = ctx.brain();
        const slug = ctx.pos[0];
        const rows = L.tasks.list(db, slug);
        const ready = rows.filter((t) => t.ready);
        print([
          ...toonTable("tasks", rows.map((t) => ({ ...t, depends_on: t.depends_on.map((d) => d.key).join(" ") })), ["key", "status", "ready", "title", "claimed_by", "depends_on"]),
          ...toonList("help", rows.length
            ? [
                ...(ready.length ? [`Claim the next ready task: brain tasks claim ${slug} --by <name>`] : []),
                `Read a task's brief: brain tasks view ${slug} <task>`,
              ]
            : [`Add one: brain tasks add ${slug} --title "..." --acceptance "..."`]),
        ]);
      },
    },
    view: {
      summary: "The brief: one task with its acceptance, dependencies, feature and run steps",
      args: [ARG.feature, ARG.task], min: 2, max: 2,
      spec: { "--full": { desc: "do not truncate long fields" } },
      examples: ["brain tasks view auth t2"],
      run(ctx) {
        const { db } = ctx.brain();
        const [slug, key] = ctx.pos;
        const t = L.tasks.get(db, slug, key);
        const full = !!ctx.flags.full;
        const fi = t.feature_info;
        const lines = kvs({ feature: `${fi.slug} — ${fi.name} (${fi.status})`, task: t.key, title: t.title, status: t.status, ready: t.ready, claimed_by: t.claimed_by });
        let truncated = false;
        truncated = addBlocks(lines, [["acceptance", t.acceptance], ["verify", t.verify], ["evidence", t.evidence]], full) || truncated;
        if (t.files.length) lines.push(kv("files", t.files.join(", ")));
        lines.push(...toonTable("depends_on", t.depends_on, ["key", "status"]));
        lines.push(...toonTable("steps", t.steps.map((s) => ({ ...s, step: clip(s.step) })), ["run", "n", "step", "at"]));
        const help = [];
        if (truncated) help.push(`Run \`brain tasks view ${slug} ${key} --full\` for the complete text`);
        if (t.status === "open") help.push(`Claim it: brain tasks claim ${slug} --key ${key} --by <name>`);
        if (t.status === "open" || t.status === "claimed") {
          help.push(`Log each step: brain runs append ${slug} --task ${key} --step "..." --observed "..."`);
          help.push(`Close it: brain tasks set ${slug} ${key} --status done --evidence "..."${t.claimed_by ? ` --by ${shellWord(t.claimed_by)}` : ""}`);
        }
        print([...lines, ...toonList("help", help.length ? help : [`Run \`brain tasks list ${slug}\``])]);
      },
    },
    add: {
      summary: "Add task t<N+1> to a feature",
      args: [ARG.feature], min: 1, max: 1,
      spec: {
        "--title": { value: true, desc: "what to do (required)" },
        "--acceptance": { value: true, desc: "checkable definition of done (required)" },
        "--verify": { value: true, desc: "how to check it (a command or a walk)" },
        "--depends-on": { value: true, desc: "comma-separated task keys that must be done first" },
        "--files": { value: true, desc: "comma-separated paths the task touches" },
      },
      examples: ['brain tasks add auth --title "login form" --acceptance "POST /login sets a cookie" --depends-on t1'],
      run(ctx) {
        const { db } = ctx.brain(), { flags } = ctx;
        const slug = ctx.pos[0];
        const { title, acceptance } = flags;
        const t = L.tasks.add(db, slug, { title, acceptance, verify: flags.verify ?? null, dependsOn: csv(flags["depends-on"]), files: csv(flags.files) });
        print([
          ...group("task", { feature: slug, key: t.key, title: t.title, ready: t.ready }),
          ...toonList("help", [`Claim it: brain tasks claim ${slug} --key ${t.key} --by <name>`, `Run \`brain tasks list ${slug}\``]),
        ]);
      },
    },
    claim: {
      summary: "Claim a task (a given --key, or the first ready one); prints the claim token",
      args: [ARG.feature], min: 1, max: 1,
      spec: {
        "--by": { value: true, desc: "who is claiming (required)" },
        "--key": { value: true, desc: "task key (default: the first ready task)" },
      },
      examples: ["brain tasks claim auth --by worker-1", "brain tasks claim auth --key t3 --by worker-2"],
      run(ctx) {
        const { db } = ctx.brain();
        const slug = ctx.pos[0];
        const { task, token } = L.tasks.claim(db, slug, { key: ctx.flags.key, by: ctx.flags.by });
        print([
          ...group("claim", { feature: slug, task: task.key, title: task.title, claimed_by: task.claimed_by, token }),
          ...toonList("help", [
            `Read the brief: brain tasks view ${slug} ${task.key}`,
            `Close it: brain tasks set ${slug} ${task.key} --status done --evidence "..." --by ${shellWord(task.claimed_by)}`,
            `Release it: brain tasks set ${slug} ${task.key} --status open --by ${shellWord(task.claimed_by)}`,
          ]),
        ]);
      },
    },
    set: {
      summary: "Update a task: --status open|done|blocked|cut, fields; closing the last open task auto-ships the feature",
      args: [ARG.feature, ARG.task], min: 2, max: 2,
      spec: {
        "--status": { value: true, desc: "open (releases a claim) | done (needs --evidence) | blocked | cut" },
        "--evidence": { value: true, desc: "what proves the acceptance holds (required for done)" },
        "--by": { value: true, desc: "the claim holder (a claimed task only moves for its holder)" },
        "--token": { value: true, desc: "the claim token, instead of --by" },
        "--title": { value: true, desc: "new title" },
        "--acceptance": { value: true, desc: "new acceptance" },
        "--verify": { value: true, desc: "new verify" },
        "--no-autoship": { desc: "do not ship the feature when this closes its last open task" },
      },
      examples: ['brain tasks set auth t2 --status done --evidence "login test passes" --by worker-1', "brain tasks set auth t3 --status blocked"],
      run(ctx) {
        const { db, root } = ctx.brain(), { flags } = ctx;
        const [slug, key] = ctx.pos;
        if (["status", "evidence", "title", "acceptance", "verify"].every((k) => flags[k] === undefined))
          usage("nothing to set", [`brain tasks set ${slug} ${key} --status done --evidence "..."`]);
        const { status, evidence, by, token, title, acceptance } = flags;
        const r = L.tasks.set(db, slug, key, { status, evidence, by, token, title, acceptance, verify: flags.verify, autoship: !flags["no-autoship"], root });
        const lines = ["task:", kv("feature", slug, 2), kv("key", r.task.key, 2), kv("status", r.task.status, 2), kv("previous", r.previous, 2)];
        if (r.ship) lines.push("ship:", kv("outcome", r.ship.outcome, 2), kv("feature", r.ship.feature.slug, 2), kv("status", r.ship.feature.status, 2));
        if (r.ship && r.ship.warning) lines.push(kv("warning", r.ship.warning.message));
        const help = r.ship
          ? [...(r.ship.warning ? r.ship.warning.help : []), `Record the PR: brain features set ${slug} --pr <url>`, "Run `brain features list` to pick the next feature"]
          : [`Run \`brain tasks list ${slug}\` for what is ready next`];
        print([...lines, ...toonList("help", help)]);
      },
    },
  },
};

// --- progress -----------------------------------------------------------------

const progress = {
  summary: "Checkpoints — the rolling where-are-we cursor: list, add (--run links a run note)",
  default: "list",
  subs: {
    list: {
      summary: "Recent checkpoints, newest first",
      spec: {
        "--limit": { value: true, desc: "how many (default 5)" },
        "--feature": { value: true, desc: "only this feature's checkpoints" },
        "--full": { desc: "include each checkpoint's body" },
      },
      examples: ["brain progress list", "brain progress list --feature auth --limit 20 --full"],
      run(ctx) {
        const { db } = ctx.brain();
        const rows = L.progress.list(db, { limit: posInt(ctx.flags.limit, "--limit") || 5, feature: ctx.flags.feature });
        const fields = ["id", "at", "branch", "feature", "run", "summary", "next"];
        if (ctx.flags.full) fields.push("body");
        const top = rows[0];
        const help = top && top.run && top.feature ? [`Read the linked run note: brain runs view ${top.feature} --run ${top.run}`] : [];
        help.push('Checkpoint: brain progress add --summary "..." --next "..." [--feature <slug>] [--run <name>]');
        print([...toonTable("checkpoints", rows, fields), ...toonList("help", help)]);
      },
    },
    add: {
      summary: "Add a checkpoint (summary ≤ 200 chars; --clip clips with …, else SUMMARY_TOO_LONG)",
      spec: {
        "--summary": { value: true, desc: "one line, ≤ 200 chars (required)" },
        "--next": { value: true, desc: "the next action, one sentence" },
        "--body": { value: true, desc: "detail (or --body-from)" },
        "--body-from": { value: true, desc: "read the body from a file, or - for stdin" },
        "--feature": { value: true, desc: "feature slug this checkpoint is about" },
        "--run": { value: true, desc: "run-note name this checkpoint links to (see `brain runs view <feature>`)" },
        "--branch": { value: true, desc: "branch (default: the current git branch, none without git)" },
        "--clip": { desc: "clip an over-long summary with … instead of failing" },
      },
      examples: [
        'brain progress add --summary "phase 2 CLI done, 120 tests green" --next "phase 3 UIs" --feature axi-core --run 2026-10-10-progress',
      ],
      run(ctx) {
        const { db, root } = ctx.brain(), { flags } = ctx;
        if (flags.body !== undefined && flags["body-from"] !== undefined) usage("pass --body or --body-from, not both", ["brain progress add --help"]);
        const body = flags["body-from"] !== undefined ? readInput(flags["body-from"], "--body-from") : flags.body ?? null;
        const { summary, feature, branch } = flags;
        const cp = L.progress.add(db, { summary, next: flags.next ?? null, body, feature, run: flags.run ?? null, branch, clip: !!flags.clip, root });
        print([
          ...group("checkpoint", { id: cp.id, at: cp.at, branch: cp.branch, feature: cp.feature, run: cp.run,
            summary: cp.summary }),
          ...toonList("help", ["Run `brain progress list` to see it", "Run `brain` for the dashboard"]),
        ]);
      },
    },
  },
};

// --- runs ---------------------------------------------------------------------

const runs = {
  summary: "Run notes — verbatim numbered steps per feature: view, append",
  default: "view",
  subs: {
    view: {
      summary: "A feature's runs, or one run's steps with --run",
      args: [ARG.feature], min: 1, max: 1,
      spec: {
        "--run": { value: true, desc: "run name (default: list the runs)" },
        "--full": { desc: "do not truncate observed output" },
      },
      examples: ["brain runs view auth", "brain runs view auth --run 2026-10-10-progress --full"],
      run(ctx) {
        const { db } = ctx.brain();
        const slug = ctx.pos[0];
        const v = L.runs.view(db, slug, { run: ctx.flags.run });
        if (!ctx.flags.run) {
          print([
            kv("feature", v.feature),
            ...toonTable("runs", v.runs, ["run", "steps", "first_at", "last_at"]),
            ...toonList("help", v.runs.length
              ? [`Read one: brain runs view ${slug} --run ${v.runs[v.runs.length - 1].run}`]
              : [`Log a step: brain runs append ${slug} --step "..." --observed "..."`]),
          ]);
          return;
        }
        const full = !!ctx.flags.full;
        const cut = !full && v.steps.some((s) => s.observed.length > 400);
        print([
          kv("feature", v.feature),
          kv("run", v.run),
          ...toonTable("steps", v.steps.map((s) => ({ ...s, observed: full ? s.observed : clip(s.observed, 400) })), ["n", "step", "observed", "task", "author", "at"]),
          ...toonList("help", [
            ...(cut ? [`Run \`brain runs view ${slug} --run ${v.run} --full\` for the verbatim output`] : []),
            `Append: brain runs append ${slug} --run ${v.run} --step "..." --observed "..."`,
          ]),
        ]);
      },
    },
    append: {
      summary: "Append step N+1 to a run (default run: <today>-progress); observed is stored verbatim",
      args: [ARG.feature], min: 1, max: 1,
      spec: {
        "--step": { value: true, desc: "what was done (required)" },
        "--observed": { value: true, desc: "the verbatim output (required); - reads stdin" },
        "--run": { value: true, desc: "run name (default: <today>-progress)" },
        "--task": { value: true, desc: "task key this step belongs to" },
        "--author": { value: true, desc: "who ran it" },
      },
      examples: [
        'brain runs append auth --step "ran the login e2e" --observed "$(npx playwright test 2>&1 | tail -5)"',
        'node --test 2>&1 | brain runs append auth --task t2 --step "unit tests" --observed -',
      ],
      run(ctx) {
        const { db } = ctx.brain(), { flags } = ctx;
        const slug = ctx.pos[0];
        const observed = flags.observed === "-" ? readInput("-", "--observed") : flags.observed;
        const r = L.runs.append(db, slug, { run: flags.run, step: flags.step, observed, task: flags.task, author: flags.author ?? null });
        print([
          ...group("run-step", { feature: r.feature, run: r.run, n: r.n, task: flags.task }),
          ...toonList("help", [
            `Run \`brain runs view ${slug} --run ${r.run}\` to see the run`,
            `Link it from a checkpoint: brain progress add --feature ${slug} --run ${r.run} --summary "..."`,
          ]),
        ]);
      },
    },
  },
};

// --- docs ---------------------------------------------------------------------

const docTarget = (pos) => {
  if (pos.length === 1 && pos[0].includes("/")) {
    const parts = pos[0].split("/");
    if (parts.length !== 2) usage(`expected <section>/<name>, got ${pos[0]}`, ["brain docs view rules/toon-axi", "brain docs list"]);
    return parts;
  }
  if (pos.length !== 2) usage("expected <section> <name> (or <section>/<name>)", ["brain docs view rules toon-axi", "brain docs list"]);
  return pos;
};

const docs = {
  summary: "Markdown docs stored in the brain (rules, recipes, codebase, architecture, features, …): list, view, set, rm",
  default: "list",
  subs: {
    list: {
      summary: "List docs, optionally one section",
      spec: { "--section": { value: true, desc: "rules|recipes|codebase|architecture|features|emails|transcripts" } },
      examples: ["brain docs list", "brain docs list --section rules"],
      run(ctx) {
        const { db } = ctx.brain();
        const rows = L.docs.list(db, { section: ctx.flags.section });
        print([
          ...toonTable("docs", rows, ["section", "name", "title", "bytes", "updated"]),
          ...toonList("help", rows.length
            ? ["Read one: brain docs view <section> <name>", 'Search them: brain search "<words>"']
            : ["Add one: brain docs set rules <name> --from <file>"]),
        ]);
      },
    },
    view: {
      summary: "Read one doc (truncated past 1200 chars unless --full)",
      args: ["<section> <name> — or <section>/<name>"], min: 1, max: 2,
      spec: { "--full": { desc: "print the whole body" } },
      examples: ["brain docs view rules toon-axi", "brain docs view rules/toon-axi --full"],
      run(ctx) {
        const { db } = ctx.brain();
        const [section, name] = docTarget(ctx.pos);
        const d = L.docs.get(db, section, name);
        const b = block("body", d.body, { full: !!ctx.flags.full });
        print([
          ...kvs({ doc: `${d.section}/${d.name}`, title: d.title, updated: d.updated }),
          ...b.lines,
          ...toonList("help", [
            ...(b.truncated ? [`Run \`brain docs view ${d.section} ${d.name} --full\` for the whole doc`] : []),
            `Replace it: brain docs set ${d.section} ${d.name} --from <file>`,
          ]),
        ]);
      },
    },
    set: {
      summary: "Create or replace a doc from a file (--from) or stdin",
      args: ["<section> <name> — or <section>/<name>"], min: 1, max: 2,
      spec: { "--from": { value: true, desc: "markdown file to store (or - for stdin; default: stdin when piped)" } },
      examples: ["brain docs set rules testing --from notes/testing.md", "cat doc.md | brain docs set recipes deploy"],
      run(ctx) {
        const { db } = ctx.brain();
        const [section, name] = docTarget(ctx.pos);
        let from = ctx.flags.from;
        if (from === undefined) {
          if (process.stdin.isTTY) usage("no body: pass --from <file> or pipe the markdown on stdin", [`brain docs set ${section} ${name} --from <file>`]);
          from = "-";
        }
        const d = L.docs.set(db, section, name, readInput(from, "--from"));
        print([
          ...group("doc", { doc: `${d.section}/${d.name}`, title: d.title, created: d.created, bytes: Buffer.byteLength(d.body) }),
          ...toonList("help", [`Run \`brain docs view ${d.section} ${d.name}\` to read it back`]),
        ]);
      },
    },
    rm: {
      summary: "Remove a doc",
      args: ["<section> <name> — or <section>/<name>"], min: 1, max: 2,
      examples: ["brain docs rm rules old-rule"],
      run(ctx) {
        const { db } = ctx.brain();
        const [section, name] = docTarget(ctx.pos);
        L.docs.remove(db, section, name);
        print(["doc:", kv("doc", `${section}/${name}`, 2), kv("removed", true, 2), ...toonList("help", [`Run \`brain docs list --section ${section}\``])]);
      },
    },
  },
};

// --- plans --------------------------------------------------------------------

const plans = {
  summary: "Reviewed plan artifacts (registered by `brain review open`): list, view",
  default: "list",
  subs: {
    list: {
      summary: "Registered plans, newest first",
      spec: {
        "--feature": { value: true, desc: "only this feature's plans" },
        "--status": { value: true, desc: "draft|in-review|reviewed|approved" },
      },
      examples: ["brain plans list", "brain plans list --feature auth"],
      run(ctx) {
        const { db } = ctx.brain();
        const rows = L.plans.list(db, { feature: ctx.flags.feature, status: ctx.flags.status });
        print([
          ...toonTable("plans", rows, ["slug", "status", "rounds", "feature", "file_path", "updated"]),
          ...toonList("help", rows.length ? ["Read one: brain plans view <slug>"] : ["Register and review a plan: brain review open plans/<plan>.html"]),
        ]);
      },
    },
    view: {
      summary: "One plan: file, hash, status and every review round with its prompts",
      args: ["<slug> — plan slug (see `brain plans list`)"], min: 1, max: 1,
      spec: { "--full": { desc: "do not truncate prompts" } },
      examples: ["brain plans view 2026-10-10-axi-architecture"],
      run(ctx) {
        const { db, root } = ctx.brain();
        const p = L.plans.get(db, ctx.pos[0]);
        // file_path is checkout-relative; `review open` resolves from the cwd.
        const reopen = path.relative(process.cwd(), path.resolve(root, p.file_path)) || p.file_path;
        const prompts = p.reviews.flatMap((r) =>
          r.prompts.map((x) => ({ round: r.round, tag: x.tag, prompt: ctx.flags.full ? x.prompt : clip(x.prompt) }))
        );
        const clipped = !ctx.flags.full && p.reviews.some((r) => r.prompts.some((x) => clip(x.prompt) !== x.prompt));
        print([
          ...kvs({ slug: p.slug, title: p.title, file: p.file_path, sha256: p.sha256, feature: p.feature, status: p.status }),
          ...kvs({ approved_by: p.approved_by, session_open: p.session_open }),
          ...toonTable("rounds", p.reviews.map((r) => ({ ...r, prompts: r.prompts.length })), ["round", "at", "ended_by", "prompts"]),
          ...toonTable("prompts", prompts, ["round", "tag", "prompt"]),
          ...toonList("help", [
            ...(clipped ? [`Prompts cut at ${CELL_LIMIT} chars (…): brain plans view ${p.slug} --full${passFlags(ctx.flags)}`] : []),
            `Reopen it for review: brain review open ${shellWord(reopen)}${passFlags(ctx.flags)}`,
          ]),
        ]);
      },
    },
  },
};

// --- review + watch (HTTP to lib/review/server.js) -------------------------

function reviewPort(flags) {
  if (flags.port !== undefined) return posInt(flags.port, "--port");
  const n = Number(process.env.BRAIN_AXI_PORT);
  return Number.isInteger(n) && n > 0 ? n : REVIEW_DEFAULT_PORT;
}

// The review server owns the session key, its state dir (~/.brain-axi, or
// BRAIN_AXI_STATE_DIR) and the screenshot-pin store (read here via
// readPins; only the server writes pins); context.js owns the plan-by-file
// lookup. Loaded lazily — only review/watch/pins need them.
let RV;
async function reviewModules() {
  if (!RV) {
    const [server, context] = await Promise.all([import("../lib/review/server.js"), import("../lib/review/context.js")]);
    RV = { stateDir: server.stateDir, sessionKey: server.sessionKey, readSession: server.readSession, hasPendingFeedback: server.hasPendingFeedback, api: server.REVIEW_API, planForFile: context.planForFile, readPins: server.readPins };
  }
  return RV;
}

async function fetchHealth(port, timeoutMs = 1500) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function waitFor(pred, capMs = 5000) {
  const start = Date.now();
  for (;;) {
    const v = await pred();
    if (v || Date.now() - start >= capMs) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
}

function spawnServer(port, dir) {
  const fd = fs.openSync(path.join(dir, "server.log"), "a");
  const child = spawn(process.execPath, [SERVER_PATH], { env: { ...process.env, BRAIN_AXI_PORT: String(port) }, detached: true, stdio: ["ignore", fd, fd] });
  child.on("error", () => {});
  child.unref();
  fs.closeSync(fd);
}

// A live server on `port` matching this CLI's version and API, spawned (or
// respawned) as needed.
async function ensureServer(port) {
  const { stateDir, api } = await reviewModules();
  const dir = stateDir();
  const log = tilde(path.join(dir, "server.log"));
  let health = await fetchHealth(port);
  if (health && (health.version !== OWN_VERSION || health.api !== api)) {
    await fetch(`http://127.0.0.1:${port}/shutdown`, { method: "POST" }).catch(() => {});
    await waitFor(async () => !(await fetchHealth(port, 500)));
    health = null;
  }
  if (!health) {
    spawnServer(port, dir);
    health = await waitFor(() => fetchHealth(port, 800));
    if (!health) fail("SERVER_DOWN", `could not start the review server on port ${port}`, [`Check ${log}`, "Try another port: --port <n>"]);
  }
  return health;
}

function openBrowser(url) {
  try {
    const child = spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // best effort
  }
}

const REVIEW_PORT_FLAG = { "--port": { value: true, desc: `review server port (default ${REVIEW_DEFAULT_PORT} or BRAIN_AXI_PORT)` } };
const ANCHOR_HELP =
  "Each prompt carries line + text anchors — apply edits with targeted reads and anchored replacements; do NOT re-read the whole artifact.";

// The real path of a plan file (a symlinked alias is the same plan — the
// server keys sessions by real path too); as given when it does not exist.
function realFile(file) {
  const abs = path.resolve(file);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

// --brain / --port as given, appended to the commands a review result
// suggests, so following them reaches the same brain and server.
function passFlags(flags) {
  return (flags.brain !== undefined ? ` --brain ${shellWord(String(flags.brain))}` : "") + (flags.port !== undefined ? ` --port ${shellWord(String(flags.port))}` : "");
}

function renderPoll(data, file, flags) {
  const ref = shellWord(file) + passFlags(flags);
  const lines = [kv("status", data.status)];
  let snapshotShown = false;
  if (data.status === "feedback") {
    const prompts = (data.prompts || []).map((p) => ({ tag: p.tag, line: p.line ?? "", selector: p.selector || "", text: p.text || "", prompt: p.prompt || "" }));
    lines.push(...toonTable("prompts", prompts, ["tag", "line", "selector", "text", "prompt"]));
    if (data.layout_warnings && data.layout_warnings.length)
      lines.push(...toonTable("layout_warnings", data.layout_warnings.map((w) => ({ ...w, persistent: !!w.persistent })), ["kind", "selector", "overflowPx", "severity", "persistent"]));
    if (flags.snapshot && data.dom_snapshot) {
      lines.push("snapshot: |", ...data.dom_snapshot.split("\n").map((l) => "  " + l));
      snapshotShown = true;
    } else lines.push(kv("snapshot_chars", data.dom_snapshot ? data.dom_snapshot.length : data.dom_snapshot_chars || 0));
  }
  if (data.redelivered) lines.push(kv("redelivered", true));
  if (data.ended_by) lines.push(kv("ended_by", data.ended_by));
  if (data.next_step) lines.push(kv("next_step", data.next_step));
  const help = [];
  if (data.status === "feedback" && !data.session_ended) {
    if (data.redelivered) help.push("This batch was delivered before but never confirmed — skip any prompt you already applied");
    help.push(`Apply the changes, then run \`brain review poll ${ref} --agent-reply "what you changed"\` to continue`);
    if ((data.prompts || []).length) help.push(ANCHOR_HELP);
    if (!snapshotShown) help.push(`Run \`brain review poll ${ref} --snapshot\` for the full DOM outline`);
    help.push(`Run \`brain review end ${ref}\` once the plan is fully approved`);
  } else if (data.session_ended || data.status === "ended") {
    if (data.ended_by === "user") {
      help.push("Apply any remaining feedback, then report in the conversation — do not reopen automatically");
      help.push(`Run \`brain review open ${ref} --reopen\` only if the user asks to resume`);
    } else help.push(`Run \`brain review open ${ref}\` to reopen the session`);
  } else help.push(`Run \`brain review open ${ref}\` first`);
  return [...lines, ...toonList("help", help)];
}

// The CLI is the one writer of review state in brain.db: a polled feedback
// batch becomes the plan's next round (exactly what the agent received), and
// a session the user ended is closed. The server only relays, and re-delivers
// a batch until ackPoll confirms it was recorded — the batch id keeps a
// re-delivery from becoming a second round.
// The session was opened for `sessionBrain`; this poll resolved `brainDir`.
function assertSessionBrain(sessionBrain, brainDir, file, flags, verb = "poll") {
  if (typeof sessionBrain !== "string" || !sessionBrain) return;
  const real = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  if (real(sessionBrain) === real(brainDir)) return;
  const port = flags.port !== undefined ? ` --port ${shellWord(String(flags.port))}` : "";
  fail("BRAIN_MISMATCH", `${file} is under review for the brain at ${sessionBrain}, not ${brainDir}; nothing was changed`, [
    `Use that brain: brain review ${verb} ${shellWord(file)} --brain ${shellWord(sessionBrain)}${port}`,
  ]);
}

function recordPoll(db, root, abs, data) {
  const userEnded = (data.session_ended || data.status === "ended") && data.ended_by === "user";
  const prompts = data.status === "feedback" ? data.prompts || [] : [];
  if (!prompts.length && !userEnded) return;
  // One write transaction (BEGIN IMMEDIATE): two polls that both see the
  // user's End serialize here, and only the first finds the session open.
  L.tx(db, () => {
    const plan = RV.planForFile(db, root, abs) || L.plans.upsert(db, { file: abs, root });
    // The first poll after the user's End (with or without a final batch)
    // records the closing round; the closed session makes repeat polls no-ops.
    const closing = userEnded && !!L.plans.get(db, plan.slug).session_open;
    if (prompts.length || closing)
      L.plans.addRound(db, plan.slug, {
        prompts: prompts.map((p) => ({ tag: p.tag, prompt: p.prompt, selector: p.selector || null, text: p.text || null, html: p.html || null, target: p.target ?? null })),
        endedBy: data.session_ended || closing ? data.ended_by : null,
        batchId: typeof data.batch === "string" && data.batch ? data.batch : null,
      });
    if (closing) L.plans.endSession(db, plan.slug);
  });
}

// Tell the server the batch is safely in brain.db so it stops re-delivering
// it. Best effort: a lost ack only means one more (deduplicated) delivery.
async function ackPoll(port, key, data) {
  if (data.status !== "feedback" || typeof data.batch !== "string" || !data.batch) return;
  try {
    await fetch(`http://127.0.0.1:${port}/api/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, batch: data.batch }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // server gone: the next poll re-delivers and the batch id dedups it
  }
}

const review = {
  summary: "Human review of a plan artifact in the browser: open, poll, end (--approved-by for headless)",
  default: "open",
  subs: {
    open: {
      summary: "Register the plan in the brain and open a browser review session",
      args: [ARG.file], min: 1, max: 1,
      spec: {
        "--no-open": { desc: "do not open the system browser" },
        "--reopen": { desc: "resume a session the user ended" },
        "--plan": { value: true, desc: "plan slug (default: the file's basename)" },
        "--feature": { value: true, desc: "feature slug this plan belongs to" },
        ...REVIEW_PORT_FLAG,
      },
      examples: ["brain review open plans/auth.html --feature auth", "brain review open plans/auth.html --reopen"],
      async run(ctx) {
        const { flags } = ctx;
        const file = ctx.pos[0];
        const ref = shellWord(file) + passFlags(flags);
        const abs = realFile(file);
        if (!fs.existsSync(abs)) fail("NOT_FOUND", `no such file: ${file}`, ["Write the plan HTML first, then open it"]);
        const { db, root, brainDir } = ctx.brain();
        const rv = await reviewModules();
        // Unrecorded feedback stays with the brain that opened the session
        // (the server refuses the move too): say so before registering here.
        const prior = rv.readSession(rv.sessionKey(abs));
        if (rv.hasPendingFeedback(prior)) assertSessionBrain(prior.brain, brainDir, file, flags);
        const known = rv.planForFile(db, root, abs);
        const plan = L.plans.upsert(db, { file: abs, slug: flags.plan || (known && known.slug), feature: flags.feature, root });
        const port = reviewPort(flags);
        await ensureServer(port);
        let data;
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/open`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ file: abs, plan: plan.slug, feature: plan.feature, reopen: !!flags.reopen, brain: brainDir, root }),
          });
          data = await res.json();
          if (!res.ok) fail("REVIEW_REJECTED", data.error || "the review server rejected the request", [data.help || `Try again: brain review open ${ref}`]);
        } catch (e) {
          if (e instanceof CliError) throw e;
          fail("SERVER_DOWN", `could not reach the review server: ${e.message}`, [`Try again: brain review open ${ref}`]);
        }
        if (data.refused) {
          print([kv("refused", data.reason), kv("url", data.url), ...toonList("help", [`Run \`brain review open ${ref} --reopen\` to resume the ended session`])]);
          return;
        }
        L.plans.startSession(db, plan.slug, { port });
        print([
          ...group("session", { plan: plan.slug, url: data.url, status: data.status, feature: plan.feature }),
          ...toonList("help", [
            `Run \`brain review poll ${ref}\` and leave it running to wait for feedback`,
            `Run \`brain review end ${ref}\` once the plan is fully approved`,
          ]),
        ]);
        if (!flags["no-open"]) openBrowser(data.url);
      },
    },
    poll: {
      summary: "Long-poll for feedback on an open session; leave it running until it returns",
      args: [ARG.file], min: 1, max: 1,
      spec: {
        "--agent-reply": { value: true, desc: "reply posted into the browser chat before waiting" },
        "--snapshot": { desc: "print the full DOM outline snapshot" },
        "--timeout-ms": { value: true, desc: "abort the long-poll after N ms" },
        ...REVIEW_PORT_FLAG,
      },
      examples: ["brain review poll plans/auth.html", 'brain review poll plans/auth.html --agent-reply "moved the CTA up"'],
      async run(ctx) {
        const { flags } = ctx;
        const file = ctx.pos[0];
        const ref = shellWord(file) + passFlags(flags);
        const timeoutMs = posInt(flags["timeout-ms"], "--timeout-ms");
        const missing = { status: "missing", next_step: `No session for this file. Run \`brain review open ${ref}\` first.` };
        const rv = await reviewModules();
        let key;
        try {
          key = rv.sessionKey(file);
        } catch {
          return void print(renderPoll(missing, file, flags));
        }
        const { db, root, brainDir } = ctx.brain();
        // Feedback is recorded into the brain that opened the session, never
        // another one polling the same file: refuse before draining anything.
        const session = rv.readSession(key);
        assertSessionBrain(session && session.brain, brainDir, file, flags);
        // The server may have exited (all sessions ended, idle) with feedback
        // or the user's End still on disk: bring it back to hand them over.
        if (session) await ensureServer(reviewPort(flags));
        // The agent edits the plan between polls: keep the recorded hash current.
        const abs = realFile(file);
        const known = rv.planForFile(db, root, abs);
        if (known) L.plans.upsert(db, { file: abs, slug: known.slug, root });
        process.stderr.write("waiting for feedback… leave this running (Ctrl-C safe: feedback is never lost)\n");
        let url = `http://127.0.0.1:${reviewPort(flags)}/api/poll?key=${encodeURIComponent(key)}`;
        if (flags["agent-reply"]) url += `&reply=${encodeURIComponent(flags["agent-reply"])}`;
        const tick = setInterval(() => process.stderr.write("still waiting — leave running\n"), 60000);
        tick.unref();
        let text;
        try {
          const res = await fetch(url, timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {});
          text = (await res.text()).trim();
        } catch (e) {
          if (e.name === "TimeoutError" || e.name === "AbortError")
            return void print([kv("status", "timeout"), ...toonList("help", [`Run \`brain review poll ${ref}\` again to keep waiting`])]);
          return void print(renderPoll(missing, file, flags));
        } finally {
          clearInterval(tick);
        }
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          fail("SERVER_BAD_RESPONSE", "malformed response from the review server", [`Run \`brain review poll ${ref}\` again`]);
        }
        // Unacked, a refused batch stays queued for the right brain's poll.
        assertSessionBrain(data.brain, brainDir, file, flags);
        recordPoll(db, root, abs, data);
        // Print (flushed) first, then ack: a CLI killed in between leaves the
        // batch unacked, so it is redelivered (and the batch_id dedups the round).
        await printFlushed(renderPoll(data, file, flags));
        await ackPoll(reviewPort(flags), key, data);
      },
    },
    end: {
      summary: "End the review session; --approved-by approves without the browser (headless/CI)",
      args: [ARG.file], min: 1, max: 1,
      spec: { "--approved-by": { value: true, desc: "who approved: records an approval round and marks the plan approved" }, ...REVIEW_PORT_FLAG },
      examples: ["brain review end plans/auth.html", "brain review end plans/auth.html --approved-by sean"],
      async run(ctx) {
        const { flags } = ctx;
        const file = ctx.pos[0];
        const ref = shellWord(file) + passFlags(flags);
        const { db, root, brainDir } = ctx.brain();
        const rv = await reviewModules();
        // Ending changes both sides (this brain's plan, the server session):
        // refuse before either when the session belongs to another brain.
        let sessionKey = null;
        try {
          sessionKey = rv.sessionKey(file);
        } catch {
          // no such file: no server session to check
        }
        const session = sessionKey ? rv.readSession(sessionKey) : null;
        assertSessionBrain(session && session.brain, brainDir, file, flags, "end");
        const abs = realFile(file);
        let plan = rv.planForFile(db, root, abs);
        if (!plan && flags["approved-by"] !== undefined) plan = L.plans.upsert(db, { file: abs, root });
        if (plan) L.plans.upsert(db, { file: abs, slug: plan.slug, root });
        const ended = plan ? L.plans.endSession(db, plan.slug, { approvedBy: flags["approved-by"], root }) : null;
        let server = "no session";
        if (sessionKey)
          try {
            const res = await fetch(`http://127.0.0.1:${reviewPort(flags)}/api/end`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ key: sessionKey, by: "agent" }),
              signal: AbortSignal.timeout(3000),
            });
            server = (await res.json()).status || "ended";
          } catch {
            // no server or no session: a no-op on that side
          }
        print([
          ...group("review", { file, plan: ended ? ended.slug : null, status: ended ? ended.status : "unregistered",
            approved_round: ended ? ended.approved_round : null, server_session: server }),
          ...toonList("help", [
            ended && ended.status === "approved" ? "Execute the approved plan (brain-execute skill)" : `Run \`brain review open ${ref}\` to reopen the session anytime`,
          ]),
        ]);
      },
    },
  },
};

const watch = {
  summary: "Open the live execution dashboard for a feature (run steps, verifications, PR)",
  args: [ARG.feature], min: 1, max: 1,
  spec: { "--no-open": { desc: "do not open the system browser" }, ...REVIEW_PORT_FLAG },
  examples: ["brain watch auth", "brain watch auth --no-open"],
  async run(ctx) {
    const { db, brainDir, root, mainRoot } = ctx.brain();
    const f = L.features.lookup(db, ctx.pos[0]);
    const port = reviewPort(ctx.flags);
    await ensureServer(port);
    // From a worktree, `root` makes the dashboard check plans in this checkout.
    const rootQs = root && mainRoot && path.resolve(root) !== path.resolve(mainRoot) ? `&root=${encodeURIComponent(root)}` : "";
    const url = `http://127.0.0.1:${port}/watch/${encodeURIComponent(f.slug)}?brain=${encodeURIComponent(brainDir)}${rootQs}`;
    print([
      ...group("watch", { feature: f.slug, status: f.status, url }),
      ...toonList("help", [
        ...(ctx.flags["no-open"] ? [`Open ${url} in a browser — it live-updates`] : []),
        `Log each step: brain runs append ${f.slug} --step "..." --observed "..."`,
        `Record the PR when opened: brain features set ${f.slug} --pr <url>`,
      ]),
    ]);
    if (!ctx.flags["no-open"]) openBrowser(url);
  },
};

// --- verifications --------------------------------------------------------------

const verifications = {
  summary: "Verdicts bound to the commit they were taken on: list, view, add (--shot attaches screenshots)",
  default: "list",
  subs: {
    list: {
      summary: "Verifications, newest first",
      spec: { "--feature": { value: true, desc: "only this feature's" } },
      examples: ["brain verifications list", "brain verifications list --feature auth"],
      run(ctx) {
        const { db } = ctx.brain();
        // Full SHAs are stored; the list shows the usual 7-char prefix.
        const rows = L.verifications.list(db, { feature: ctx.flags.feature }).map((v) => ({ ...v, commit: v.commit && v.commit.slice(0, 7) }));
        print([
          ...toonTable("verifications", rows, ["feature", "round", "verdict", "commit", "dirty", "verified_by", "at"]),
          ...toonList("help", rows.length
            ? ["Read one: brain verifications view <feature> [--round N]"]
            : ['Record one: brain verifications add <feature> --verdict PASS|FAIL|BLOCKED --body "..."']),
        ]);
      },
    },
    view: {
      summary: "One verification (latest round unless --round) with its body and shots, plus the feature's sent screenshot pins from `brain watch`",
      args: [ARG.feature], min: 1, max: 1,
      spec: { "--round": { value: true, desc: "round number (default: latest)" }, "--full": { desc: "print the whole body" } },
      examples: ["brain verifications view auth", "brain verifications view auth --round 1 --full"],
      async run(ctx) {
        const { db, brainDir, mainRoot } = ctx.brain();
        const v = L.verifications.get(db, ctx.pos[0], posInt(ctx.flags.round, "--round"));
        const b = block("body", v.body, { full: !!ctx.flags.full });
        // The feature's screenshot pins (all rounds). Only sent pins are a
        // settled ask; unsent ones are still being drafted in `brain watch`.
        const all = await readPinsSafe(brainDir, v.feature, mainRoot);
        const sent = pinStates(db, all.filter((p) => p.sentAt));
        const open = sent.filter((p) => p.state === "open");
        const pos = (p) => (p.x == null || p.y == null ? "none" : `${p.x}%,${p.y}%`);
        print([
          ...kvs({ feature: v.feature, round: v.round, verdict: v.verdict, commit: v.commit, dirty: v.dirty,
            verified_by: v.verified_by, implemented_by: v.implemented_by, at: v.at }),
          ...b.lines,
          ...toonTable("shots", v.shots, ["path", "caption", "sha256"]),
          ...(sent.length
            ? toonTable("pins", sent.map((p) => ({ shot: p.shot, pin: pos(p), note: p.note || "", created: p.at || "", sent: p.sentAt,
                state: p.state })), ["shot", "pin", "note", "created", "sent", "state"])
            : []),
          ...(all.length > sent.length ? [kv("draft_pins", `${all.length - sent.length} unsent (still being drafted in brain watch — not an ask yet)`)] : []),
          ...toonList("help", [
            ...(b.truncated ? [`Run \`brain verifications view ${v.feature} --round ${v.round} --full\` for the whole body`] : []),
            ...(open.length
              ? [`Act on the ${open.length} sent open pin${open.length > 1 ? "s" : ""} (the reviewer's asks): fix each, re-capture its shot, then re-verify: brain verifications add ${v.feature} --verdict ... --shot <path>`]
              : []),
            ...(!open.length && v.verdict === "PASS" ? [`Ship it: brain features ship ${v.feature} --evidence "..."`] : []),
            ...(v.verdict !== "PASS" && !open.length ? [`Fix, then re-verify: brain verifications add ${v.feature} --verdict ...`] : []),
          ]),
        ]);
      },
    },
    add: {
      summary: "Record a verdict as the next round; stamps HEAD's commit, and dirty:true on an uncommitted tree",
      args: [ARG.feature], min: 1, max: 1,
      spec: {
        "--verdict": { value: true, desc: "PASS | FAIL | BLOCKED (required)" },
        "--body": { value: true, desc: "the verifier's walk, verbatim (or --body-from)" },
        "--body-from": { value: true, desc: "read the body from a file, or - for stdin" },
        "--shot": { value: true, repeat: true, desc: "screenshot under the brain's shots/<feature>/ (.brain/shots/ by default, <brainDir>/shots/ with --brain; the MAIN checkout's, gitignored, shared by every worktree; only the path + sha256 is recorded); `path::caption` adds a caption" },
        "--verified-by": { value: true, desc: "who verified (default feature-verifier)" },
        "--implemented-by": { value: true, desc: "who implemented (default: HEAD's author)" },
      },
      examples: [
        'brain verifications add auth --verdict PASS --body-from verdict.md --shot .brain/shots/auth/login.png::"login form"',
        'brain verifications add auth --verdict FAIL --body "step 3: 500 on submit"',
      ],
      run(ctx) {
        const { db, root, mainRoot, brainDir } = ctx.brain(), { flags } = ctx;
        const slug = ctx.pos[0];
        if (flags.body !== undefined && flags["body-from"] !== undefined) usage("pass --body or --body-from, not both", ["brain verifications add --help"]);
        const shots = (flags.shot || []).map((s) => {
          const i = s.indexOf("::");
          return i === -1 ? { path: s } : { path: s.slice(0, i), caption: s.slice(i + 2) };
        });
        const v = L.verifications.add(db, slug, {
          verdict: flags.verdict,
          body: flags["body-from"] !== undefined ? readInput(flags["body-from"], "--body-from") : flags.body,
          shots,
          verifiedBy: flags["verified-by"],
          implementedBy: flags["implemented-by"],
          root,
          mainRoot,
          brainDir,
          cwd: process.cwd(),
        });
        const help = [];
        if (v.dirty) help.push("The tree had uncommitted changes (dirty: true): commit, then re-verify for a clean receipt");
        if (v.verdict === "PASS") help.push(`Ship it: brain features ship ${slug} --evidence "verifier PASS round ${v.round}"`);
        else help.push(`Fix the failures, then record the next round: brain verifications add ${slug} --verdict ...`);
        print([
          ...group("verification", { feature: v.feature, round: v.round, verdict: v.verdict, commit: v.commit, dirty: v.dirty,
            shots: v.shots.length }),
          ...toonList("help", help),
        ]);
      },
    },
  },
};

// --- verify -----------------------------------------------------------------------

const verify = {
  summary: "Declared project checks: list, add, run (--stage/--only; records gate rows). Bare `brain verify` runs them",
  default: "run",
  subs: {
    list: {
      summary: "Declared checks",
      spec: { "--stage": { value: true, desc: "bootstrap|baseline|verify" } },
      examples: ["brain verify list"],
      run(ctx) {
        const { db } = ctx.brain();
        const rows = L.verify.listChecks(db, { stage: ctx.flags.stage });
        print([
          ...toonTable("checks", rows.map((c) => ({ ...c, stages: c.stages.join(" ") })), ["name", "stages", "timeout", "run"]),
          ...toonList("help", rows.length
            ? ["Run them: brain verify run --stage baseline"]
            : ['declare real checks with brain verify add <name> --run "<command>" --stages baseline,verify']),
        ]);
      },
    },
    add: {
      summary: "Declare a check (a shell command run from the repo root, gated on exit code)",
      args: ["<name> — check name"], min: 1, max: 1,
      spec: {
        "--run": { value: true, desc: "shell command (required)" },
        "--stages": { value: true, desc: "comma-separated: bootstrap,baseline,verify (default verify)" },
        "--timeout": { value: true, desc: "seconds (default 300)" },
        "--replace": { desc: "overwrite a check with the same name" },
      },
      examples: ['brain verify add test --run "node --test" --stages baseline,verify'],
      run(ctx) {
        const { db } = ctx.brain(), { flags } = ctx;
        const stages = csv(flags.stages);
        const c = L.verify.addCheck(db, {
          name: ctx.pos[0],
          run: flags.run,
          stages: stages.length ? stages : undefined,
          timeout: posInt(flags.timeout, "--timeout"),
          replace: !!flags.replace,
        });
        print([
          ...group("check", { name: c.name, run: c.run, stages: c.stages.join(" "), timeout: c.timeout, replaced: c.replaced }),
          ...toonList("help", [`Try it: brain verify run --only ${c.name}`]),
        ]);
      },
    },
    run: {
      summary: "Run declared checks sequentially from the repo root; exit 1 if any fail (zero declared → NO_CHECKS)",
      spec: {
        "--stage": { value: true, desc: "bootstrap|baseline|verify (default: all checks)" },
        "--only": { value: true, desc: "comma-separated check names" },
        "--feature": { value: true, desc: "attribute the gate rows to this feature" },
      },
      examples: ["brain verify run --stage baseline", "brain verify run --only test"],
      run(ctx) {
        const { db, root } = ctx.brain();
        const r = L.verify.run(db, {
          stage: ctx.flags.stage,
          only: csv(ctx.flags.only),
          feature: ctx.flags.feature,
          root,
          onResult: (x) => process.stderr.write(`${x.status} ${x.check} (${x.seconds}s)\n`),
        });
        const failed = r.results.filter((x) => x.status !== "pass");
        const lines = [kv("stage", r.stage || "all"), kv("ok", r.ok), ...toonTable("results", r.results, ["check", "status", "exit", "seconds"])];
        for (const x of failed) lines.push(...block(`tail_${x.check.replace(/[^A-Za-z0-9_]/g, "_")}`, x.tail, { full: true }).lines);
        print([
          ...lines,
          ...toonList("help", r.ok
            ? ["All declared checks pass"]
            : [`Fix the failing check(s), then re-run: brain verify run --only ${failed.map((x) => x.check).join(",")}`]),
        ]);
        if (!r.ok) process.exitCode = 1;
      },
    },
  },
};

// --- search + check -----------------------------------------------------------

const search = {
  summary: "Full-text search (FTS5) across features, docs, checkpoints, run steps and verifications",
  args: ["<query> — words; all must match, the last as a prefix"], min: 1, max: Infinity,
  spec: {
    "--kind": { value: true, desc: "feature|doc|checkpoint|run-step|verification" },
    "--limit": { value: true, desc: "max results (default 20)" },
    "--raw": { desc: "pass FTS5 syntax through" },
  },
  examples: ['brain search "one in progress"', "brain search verify --kind doc"],
  run(ctx) {
    const { db } = ctx.brain();
    const q = ctx.pos.join(" ");
    const rows = L.search.query(db, q, { kind: ctx.flags.kind, limit: posInt(ctx.flags.limit, "--limit") || 20, raw: !!ctx.flags.raw });
    const view = { feature: "brain features view <ref>", doc: "brain docs view <ref>", checkpoint: "brain progress list", "run-step": "brain runs view <feature> --run <run>", verification: "brain verifications view <feature>" };
    print([
      kv("query", q),
      ...toonTable("results", rows, ["kind", "ref", "title", "snippet"]),
      ...toonList("help", rows.length
        ? [...new Set(rows.map((r) => view[r.kind]))].map((c) => `Open a hit: ${c}`)
        : ["No hits — try fewer or different words, or `brain docs list`"]),
    ]);
  },
};

const check = {
  summary: "Integrity: SQLite integrity + foreign keys + search index + cross-entity rules + plan/shot file hashes",
  examples: ["brain check"],
  run(ctx) {
    const { db, root, mainRoot } = ctx.brain();
    const rows = L.check(db, { root, mainRoot });
    const failed = rows.filter((r) => r.status !== "pass");
    print([
      kv("ok", !failed.length),
      ...toonTable("checks", rows, ["check", "status", "detail"]),
      ...toonList("help", failed.length ? ["Each failing row names the fix; apply it, then re-run `brain check`"] : ["Run `brain verify run --stage baseline` for the project's own checks"]),
    ]);
    if (failed.length) process.exitCode = 1;
  },
};

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const COMMANDS = {
  init,
  context,
  export: exportCmd,
  import: importCmd,
  features,
  tasks,
  progress,
  runs,
  docs,
  plans,
  review,
  watch,
  verifications,
  verify,
  search,
  check,
};

function groupHelp(name, cmd) {
  print([
    kv("command", `brain ${name}`),
    kv("summary", cmd.summary),
    ...toonTable("subcommands", Object.entries(cmd.subs).map(([sub, s]) => ({ name: sub, summary: s.summary })), ["name", "summary"]),
    kv("default", `brain ${name} = brain ${name} ${cmd.default}`),
    ...toonList("help", [`Run \`brain ${name} <subcommand> --help\` for its args and flags`]),
  ]);
}

// Resolve argv to a leaf command. Returns { label, leaf, rest } or null when
// group help was printed.
function resolve(name, argv) {
  const cmd = COMMANDS[name];
  if (!cmd.subs) return { label: name, leaf: cmd, rest: argv };
  const first = argv[0];
  if (first !== undefined && Object.hasOwn(cmd.subs, first)) return { label: `${name} ${first}`, leaf: cmd.subs[first], rest: argv.slice(1) };
  const dd = argv.indexOf("--");
  const flagPart = dd === -1 ? argv : argv.slice(0, dd);
  if (flagPart.includes("--help") && (first === undefined || first.startsWith("--"))) return groupHelp(name, cmd), null;
  if (first !== undefined && !first.startsWith("--") && !cmd.default)
    usage(`unknown subcommand \`${first}\` for \`brain ${name}\``, [`valid: ${Object.keys(cmd.subs).join(", ")}`]);
  return { label: `${name} ${cmd.default}`, leaf: cmd.subs[cmd.default], rest: argv };
}

async function runLeaf(label, leaf, argv) {
  const { flags, pos } = parseArgs(argv, leaf.spec || {}, label);
  // `context` is exempt: its output has a hard byte cap (the SessionStart
  // hook injects it into every session) and hooks never pass --brain.
  hintBrain = flags.brain !== undefined && label !== "context" ? ` --brain ${shellWord(String(flags.brain))}` : "";
  if (flags.help) return print(helpLines(label, leaf));
  const min = leaf.min || 0;
  const max = leaf.max ?? 0;
  if (pos.length < min)
    usage(`missing required argument ${(leaf.args || [])[pos.length]?.split(" — ")[0] || ""}`.trim(), [
      ...(leaf.examples || []).slice(0, 1),
      `Run \`brain ${label} --help\` for usage`,
    ]);
  if (pos.length > max) {
    const subs = COMMANDS[label.split(" ")[0]]?.subs;
    usage(`unexpected argument \`${pos[max]}\` for \`brain ${label}\``, [
      ...(subs ? [`subcommands: ${Object.keys(subs).join(", ")}`] : []),
      `Run \`brain ${label} --help\` for usage`,
    ]);
  }
  let opened = null;
  const ctx = {
    flags,
    pos,
    label,
    brain() {
      if (!opened) opened = L.openBrain(process.cwd(), { brain: flags.brain });
      return opened;
    },
  };
  try {
    await leaf.run(ctx);
  } finally {
    if (opened) L.close(opened.db);
  }
}

async function main(argv) {
  const name = argv[0];
  if (NODE_MAJOR < MIN_NODE) {
    if (name === "context") return; // the SessionStart hook never breaks a session
    print([
      kv("error", `brain-axi needs node >=${MIN_NODE} (this is ${process.version}): it stores the brain in node:sqlite`),
      kv("code", "NODE_TOO_OLD"),
      ...toonList("help", ["Install Node 24+ (e.g. `nvm install 24`), then re-run", "Or pin the markdown-era CLI: npx -y brain-axi@0.2.0 <command>"]),
    ]);
    process.exitCode = 2;
    return;
  }
  try {
    L = await import("../lib/brain/index.js");
  } catch (e) {
    if (name === "context") return;
    throw e;
  }
  if (name === undefined || name.startsWith("--")) {
    const { flags } = parseArgs(argv, {}, "");
    if (flags.help) return globalHelp();
    return runLeaf("", { summary: "Dashboard", run: home }, argv);
  }
  if (!Object.hasOwn(COMMANDS, name))
    usage(`unknown command \`${name}\``, [`valid commands: ${Object.keys(COMMANDS).join(", ")}`, "Run `brain --help` for what each does"]);
  if (name === "context") {
    // Silent outside a brain, without brain.db, on a legacy brain, on any error.
    try {
      await runLeaf("context", context, argv.slice(1));
    } catch (e) {
      if (process.env.BRAIN_DEBUG) process.stderr.write(`brain context: ${e.message}\n`);
    }
    process.exitCode = 0;
    return;
  }
  const r = resolve(name, argv.slice(1));
  if (r) await runLeaf(r.label, r.leaf, r.rest);
}

main(process.argv.slice(2)).catch((e) => {
  if (e && typeof e.exitCode === "number" && Array.isArray(e.help)) return printError(e);
  print([kv("error", `unexpected error: ${e && e.message}`), kv("code", "INTERNAL"), ...toonList("help", ["Re-run with BRAIN_DEBUG=1 for the stack on stderr"])]);
  if (process.env.BRAIN_DEBUG) process.stderr.write(String(e && e.stack) + "\n");
  process.exitCode = 1;
});
