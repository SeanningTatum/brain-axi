// lib/brain/docs.js — markdown docs stored as rows: list, get, set, remove.

import { BrainError } from "./errors.js";
import { NAME_RE, now, plain, tx } from "./util.js";

// emails + transcripts stay: other users' brains still use them.
export const SECTIONS = ["rules", "recipes", "codebase", "architecture", "features", "emails", "transcripts"];

function assertSection(section) {
  if (!SECTIONS.includes(section))
    throw new BrainError("INVALID_SECTION", `invalid section "${section}"`, [`valid sections: ${SECTIONS.join(", ")}`]);
}

function assertName(name) {
  if (typeof name !== "string" || !NAME_RE.test(name))
    throw new BrainError("INVALID_NAME", `invalid doc name "${name}" — letters, digits, ".", "_" and "-"`, [
      "brain docs set rules <name> --from <file>",
    ]);
}

export const titleOf = (body) => {
  const m = /^#\s+(.+?)\s*#*\s*$/m.exec(body);
  return m ? m[1] : null;
};

// [{ section, name, title, bytes, updated }] by section then name.
export function list(db, { section } = {}) {
  if (section !== undefined) assertSection(section);
  return db
    .prepare(
      `SELECT section, name, title, length(CAST(body AS BLOB)) AS bytes, updated FROM docs
       ${section ? "WHERE section = ?" : ""} ORDER BY section, name`
    )
    .all(...(section ? [section] : []))
    .map(plain);
}

export function get(db, section, name) {
  assertSection(section);
  const row = db.prepare("SELECT section, name, title, body, updated FROM docs WHERE section = ? AND name = ?").get(section, name);
  if (!row) {
    const names = db.prepare("SELECT name FROM docs WHERE section = ? ORDER BY name").all(section).map((r) => r.name);
    throw new BrainError("NOT_FOUND", `no doc ${section}/${name}`, [
      names.length ? `${section}: ${names.join(", ")}` : `brain docs set ${section} ${name} --from <file>`,
    ]);
  }
  return plain(row);
}

// Create or replace a doc. The title is the first "# " heading.
export function set(db, section, name, body) {
  assertSection(section);
  assertName(name);
  if (typeof body !== "string" || !body.trim())
    throw new BrainError("INVALID_ARG", "body is empty", [`brain docs set ${section} ${name} --from <file>`]);
  return tx(db, () => {
    const existed = !!db.prepare("SELECT 1 FROM docs WHERE section = ? AND name = ?").get(section, name);
    db.prepare(
      `INSERT INTO docs (section, name, title, body, updated) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (section, name) DO UPDATE SET title = excluded.title, body = excluded.body, updated = excluded.updated`
    ).run(section, name, titleOf(body), body, now());
    return { ...get(db, section, name), created: !existed };
  });
}

export function remove(db, section, name) {
  get(db, section, name);
  db.prepare("DELETE FROM docs WHERE section = ? AND name = ?").run(section, name);
  return { section, name, removed: true };
}
