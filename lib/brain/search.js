// lib/brain/search.js — FTS5 across features, docs, checkpoints, run steps
// and verifications. The index is kept in sync by triggers (001-core.sql).

import { BrainError } from "./errors.js";
import { plain } from "./util.js";

export const KINDS = ["feature", "doc", "checkpoint", "run-step", "verification"];

// Free text → an FTS5 query: every word must appear (prefix match on the
// last), so punctuation in the input can never be FTS syntax.
export function toMatch(text) {
  const words = String(text).match(/[\p{L}\p{N}_]+/gu) || [];
  return words.map((w, i) => `"${w}"${i === words.length - 1 ? "*" : ""}`).join(" ");
}

// [{ kind, ref, title, snippet, rank }] best first. `raw` passes FTS5 syntax
// through (bad syntax → BAD_QUERY).
export function query(db, text, { kind, limit = 20, raw = false } = {}) {
  if (kind !== undefined && !KINDS.includes(kind))
    throw new BrainError("INVALID_ARG", `invalid kind "${kind}"`, [`valid kinds: ${KINDS.join(", ")}`]);
  const match = raw ? String(text) : toMatch(text);
  if (!match.trim())
    throw new BrainError("BAD_QUERY", "the query has no searchable words", ['brain search "<words>"']);
  try {
    return db
      .prepare(
        `SELECT kind, ref, title, snippet(search, -1, '[', ']', '…', 12) AS snippet, bm25(search, 0, 0, 5, 1) AS rank
         FROM search WHERE search MATCH ? ${kind ? "AND kind = ?" : ""} ORDER BY rank LIMIT ?`
      )
      .all(match, ...(kind ? [kind] : []), limit)
      .map(plain);
  } catch (e) {
    if (/fts5|syntax|no such column|unterminated/i.test(e.message))
      throw new BrainError("BAD_QUERY", `bad search query: ${e.message}`, ['Drop the special characters: brain search "<words>"']);
    throw e;
  }
}
