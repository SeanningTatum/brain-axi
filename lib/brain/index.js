// lib/brain — the only code that touches brain.db. Plain functions, one
// module per domain, each taking a db handle first and throwing BrainError.
//
//   import { openBrain, features } from "../lib/brain/index.js";
//   const { db, root } = openBrain();       // NO_DB / LEGACY_BRAIN / DB_TOO_NEW
//   features.list(db);

export { BrainError, isBrainError } from "./errors.js";
export { openBrain, open, create, close, locate, migrate, loadMigrations, schemaVersion, isLegacyBrain, check } from "./db.js";
export { clipChars, SUMMARY_MAX_CHARS } from "./util.js";
export * as db from "./db.js";
export * as features from "./features.js";
export * as tasks from "./tasks.js";
export * as progress from "./progress.js";
export * as runs from "./runs.js";
export * as docs from "./docs.js";
export * as plans from "./plans.js";
export * as verifications from "./verifications.js";
export * as verify from "./verify.js";
export * as search from "./search.js";
export * as io from "./io.js";
export * as toon from "./toon.js";
