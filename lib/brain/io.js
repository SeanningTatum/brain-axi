// lib/brain/io.js — deterministic TOON dump ↔ DB. The dump carries
// `version:` (the dump format) and `schema:` (user_version) so import can
// read old dumps; ids are kept so export → import → export is byte-identical.
// The search index is not dumped: triggers rebuild it on import.

import { BrainError } from "./errors.js";
import { schemaVersion } from "./db.js";
import { kv, parseRow, parseScalar, toonTable } from "./toon.js";
import { tx } from "./util.js";

export const EXPORT_VERSION = 1;
// FK order: parents before children.
export const TABLES = [
  "features",
  "feature_deps",
  "tasks",
  "task_deps",
  "checkpoints",
  "run_steps",
  "docs",
  "plans",
  "review_rounds",
  "review_prompts",
  "verifications",
  "shots",
  "verify_checks",
  "gate_runs",
];

const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
const orderBy = (cols) => (cols.includes("id") ? "id" : cols.join(", "));

// Every table is read inside one read transaction, so a concurrent writer
// (another worktree) cannot land rows between two tables' reads and leave
// the dump with children whose parents are missing.
export function exportAll(db) {
  const own = !db.isTransaction;
  if (own) db.exec("BEGIN");
  try {
    const lines = [kv("format", "brain-export"), kv("version", EXPORT_VERSION), kv("schema", schemaVersion(db))];
    for (const t of TABLES) {
      const cols = columns(db, t);
      const rows = db.prepare(`SELECT * FROM ${t} ORDER BY ${orderBy(cols)}`).all();
      lines.push(...toonTable(t, rows, cols));
    }
    return lines.join("\n") + "\n";
  } finally {
    if (own) db.exec("COMMIT");
  }
}

function parseDump(text) {
  const header = {};
  const tables = {};
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const t = /^([a-z_]+)\[(\d+)\]\{([^}]*)\}:$/.exec(line);
    if (t) {
      const cols = t[3] ? t[3].split(",") : [];
      const rows = [];
      for (let k = 0; k < Number(t[2]); k++) {
        const row = lines[++i];
        if (row === undefined || !row.startsWith("  "))
          throw new BrainError("IMPORT_PARSE", `${t[1]}: expected ${t[2]} rows, found ${k} (line ${i + 1})`, ["Re-export the source brain"]);
        let vals;
        try {
          vals = parseRow(row.slice(2));
        } catch (e) {
          throw new BrainError("IMPORT_PARSE", `${t[1]} line ${i + 1}: ${e.message}`, ["Re-export the source brain"]);
        }
        if (vals.length !== cols.length)
          throw new BrainError("IMPORT_PARSE", `${t[1]} line ${i + 1}: ${vals.length} values for ${cols.length} columns`, [
            "Re-export the source brain",
          ]);
        rows.push(vals);
      }
      if (Object.hasOwn(tables, t[1]))
        throw new BrainError("IMPORT_PARSE", `${t[1]} appears twice (line ${i + 1}); a dump has one section per table`, ["Re-export the source brain"]);
      tables[t[1]] = { cols, rows };
      continue;
    }
    const h = /^([a-z_]+): (.*)$/.exec(line);
    if (!h) throw new BrainError("IMPORT_PARSE", `line ${i + 1} is neither a header nor a table: ${line.slice(0, 60)}`, ["Re-export the source brain"]);
    header[h[1]] = parseScalar(h[2]);
  }
  return { header, tables };
}

// Load a dump into an EMPTY brain, in one transaction. Columns are matched
// by name, so a dump from an older schema loads with defaults for new ones.
// Returns { version, schema, rows: { table: n } }.
export function importAll(db, text) {
  const { header, tables } = parseDump(text);
  if (header.format !== "brain-export")
    throw new BrainError("IMPORT_PARSE", "not a brain export (missing `format: brain-export`)", ["brain export > export.toon"]);
  if (header.version !== EXPORT_VERSION)
    throw new BrainError("IMPORT_VERSION", `export format v${header.version} is not readable by this brain-axi (v${EXPORT_VERSION})`, [
      "upgrade brain-axi: npx -y brain-axi@latest import <file>",
    ]);
  if (typeof header.schema === "number" && header.schema > schemaVersion(db))
    throw new BrainError("IMPORT_VERSION", `the dump is schema v${header.schema}; this brain-axi knows v${schemaVersion(db)}`, [
      "upgrade brain-axi: npx -y brain-axi@latest import <file>",
    ]);
  const unknown = Object.keys(tables).filter((t) => !TABLES.includes(t));
  if (unknown.length)
    throw new BrainError("IMPORT_PARSE", `unknown table(s) in dump: ${unknown.join(", ")}`, ["Re-export with a matching brain-axi"]);
  return tx(db, () => {
    const nonEmpty = TABLES.filter((t) => db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get());
    if (nonEmpty.length)
      throw new BrainError("IMPORT_NOT_EMPTY", `this brain already has data (${nonEmpty.join(", ")}); import only fills an empty brain`, [
        "Import into a fresh brain: move .brain/brain.db aside, run `brain init`, then `brain import <file>`",
      ]);
    const counts = {};
    for (const t of TABLES) {
      const data = tables[t];
      counts[t] = 0;
      if (!data || !data.rows.length) continue;
      const known = new Set(columns(db, t));
      const bad = data.cols.filter((c) => !known.has(c));
      if (bad.length)
        throw new BrainError("IMPORT_PARSE", `${t} has unknown column(s) ${bad.join(", ")}`, ["Re-export with a matching brain-axi"]);
      const ins = db.prepare(`INSERT INTO ${t} (${data.cols.join(", ")}) VALUES (${data.cols.map(() => "?").join(", ")})`);
      for (const r of data.rows) ins.run(...r.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v)));
      counts[t] = data.rows.length;
    }
    return { version: header.version, schema: header.schema, rows: counts };
  });
}
