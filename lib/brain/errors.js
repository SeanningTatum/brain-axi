// lib/brain/errors.js — the one error type the library throws.
// The CLI maps `exitCode` to the process exit and renders `help` as the
// `help:` list. Library code never prints and never calls process.exit.

// Codes that mean "the input was wrong" (exit 2). Everything else is an
// operation failure (exit 1).
const USAGE_CODES = new Set([
  "INVALID_ARG",
  "INVALID_SLUG",
  "INVALID_NAME",
  "INVALID_STATUS",
  "INVALID_SECTION",
  "INVALID_STAGE",
  "INVALID_VERDICT",
  "EVIDENCE_REQUIRED",
  "SUMMARY_TOO_LONG",
  "BAD_QUERY",
]);

export class BrainError extends Error {
  constructor(code, message, help = [], detail = undefined) {
    super(message);
    this.name = "BrainError";
    this.code = code;
    this.help = Array.isArray(help) ? help : [help];
    if (detail !== undefined) this.detail = detail;
  }
  get hint() {
    return this.help;
  }
  get exitCode() {
    return USAGE_CODES.has(this.code) ? 2 : 1;
  }
}

export function isBrainError(e, code) {
  return e instanceof BrainError && (code === undefined || e.code === code);
}

// node:sqlite constraint failures → BrainError CONSTRAINT, so callers never
// see a raw driver error for a rule the schema enforces.
export function fromSqlite(e) {
  if (e instanceof BrainError) return e;
  const msg = String((e && e.message) || e);
  if (/features_one_in_progress/.test(msg))
    return new BrainError("ONE_IN_PROGRESS", "another feature is already in-progress", [
      "Run `brain features list --status in-progress` to see which one holds the slot",
    ]);
  if (e && e.code === "ERR_SQLITE_ERROR" && /constraint failed/i.test(msg))
    return new BrainError("CONSTRAINT", msg.replace(/^.*?:\s*/, "schema rule violated: "), [
      "Nothing was written — fix the value named above and retry",
    ]);
  return e;
}
