#!/usr/bin/env node
// lib/review/server.js — HTTP server for `brain review` and `brain watch`.
// node:http only, zero runtime deps, loopback-only. Serves the review chrome,
// long-polls feedback to the agent, streams SSE updates to the browser, and
// serves the watch dashboard. Brain data comes from brain.db through lib/brain
// (read-only, via ./context.js): the CLI is the single writer of review rounds
// and plan state; this process only owns its own session state (pending
// prompts, chat, layout warnings) and screenshot pins, kept in <stateDir>.
//
// Directly runnable: `node lib/review/server.js [--port N]`. Also exports
// `startServer({port})`, and `stateDir()` / `sessionKey()` / `readPins()` for
// the CLI.
//
// stdout is never used here — diagnostics go to stderr (the CLI redirects
// this process's stdio to <stateDir>/server.log).
//
// See docs/REVIEW-ARCHITECTURE.md for the HTTP API contract.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";

import * as L from "../brain/index.js";
import { executionContext, watchContext, planContext, healthChecks, planForFile, isRecordedShot, sha256OfFile, withSuperseded } from "./context.js";

// ---------------------------------------------------------------------------
// State dir + session key — the one definition the CLI imports too
// ---------------------------------------------------------------------------

// Per-machine review state lives outside the repo: ~/.brain-axi, or
// BRAIN_AXI_STATE_DIR. Holds sessions.json (sessions + pins) and server.log.
const stateDirPath = () => (process.env.BRAIN_AXI_STATE_DIR ? path.resolve(process.env.BRAIN_AXI_STATE_DIR) : path.join(os.homedir(), ".brain-axi"));

export function stateDir() {
  const dir = stateDirPath();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// A session is keyed by the artifact file's real path.
export function sessionKey(file) {
  const real = fs.realpathSync(path.resolve(file));
  return crypto.createHash("sha256").update(real).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Session + pin store: <stateDir>/sessions.json = { sessions: {key: Session},
// pins: {"<brainDir>::<feature>": [Pin]} }. Whole-file rewrite per mutation
// (one process, low volume). Missing or corrupt state is an empty store.
// ---------------------------------------------------------------------------

const statePath = (dir = stateDir()) => path.join(dir, "sessions.json");
// Pre-0.3 servers kept the same session shape in state.json. Until the first
// save writes sessions.json, read it so queued prompts, chat and the user-end
// latch survive the upgrade (state.json itself is left untouched).
const legacyStatePath = (dir = stateDir()) => path.join(dir, "state.json");

// `dir` lets a read-only caller (readPins) skip stateDir()'s mkdir.
function loadState(dir = stateDir()) {
  try {
    const file = fs.existsSync(statePath(dir)) ? statePath(dir) : legacyStatePath(dir);
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.sessions && typeof parsed.sessions === "object")
      return { sessions: parsed.sessions, pins: parsed.pins && typeof parsed.pins === "object" ? parsed.pins : {} };
  } catch {
    // missing or corrupt — start empty
  }
  return { sessions: {}, pins: {} };
}

// Write a private temp file, then rename it over sessions.json: a crash or a
// failed write mid-save can never leave a truncated store (which loadState
// would read as empty, dropping every queued batch and pin).
function saveState(state) {
  const file = statePath();
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

// Every read-modify-write of sessions.json holds <stateDir>/sessions.json.lock
// (an atomic mkdir): servers on different ports share the store, and an
// unlocked load-then-save in one could erase another's pin or queued batch.
// Held for one synchronous load+save; a lock older than LOCK_STALE_MS (its
// holder died mid-save) is broken.
const LOCK_STALE_MS = 2000;
const lockWait = new Int32Array(new SharedArrayBuffer(4));
function withStateLock(fn) {
  const lock = `${statePath()}.lock`;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    let age = 0;
    try {
      age = Date.now() - fs.statSync(lock).mtimeMs;
    } catch {
      continue; // released between mkdir and stat: retry now
    }
    if (age > LOCK_STALE_MS) fs.rmSync(lock, { recursive: true, force: true });
    else Atomics.wait(lockWait, 0, 0, 2);
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}
const locked = (fn) => (...args) => withStateLock(() => fn(...args));

// Load, let `fn` mutate the session `key`, save. Returns fn's result, or null
// (no write) when the session does not exist.
const mutateSession = locked(mutateSessionUnlocked);
function mutateSessionUnlocked(key, fn) {
  const state = loadState();
  const session = state.sessions[key];
  if (!session) return null;
  const out = fn(session);
  session.updated_at = new Date().toISOString();
  saveState(state);
  return out === undefined ? session : out;
}

function sessionUrl(key) {
  return `http://127.0.0.1:${process.env.BRAIN_AXI_PORT || 4517}/session/${key}`;
}

function getSession(key) {
  return loadState().sessions[key] || null;
}

// Read-only session lookup for the CLI (no server needed: the store is on
// disk), so `brain review poll` can check the session's brain and restart a
// server that exited while the session still had feedback to hand over.
export function readSession(key) {
  return getSession(key);
}

// Feedback the CLI has not recorded yet: queued prompts or an unacked batch.
export function hasPendingFeedback(session) {
  return !!session && ((Array.isArray(session.prompts) && session.prompts.length > 0) || !!session.inflight);
}

function listSessions() {
  return Object.values(loadState().sessions);
}

// Create or revive. `force` is --reopen: without it a user-ended session is
// refused (the user-end latch). Reviving keeps queued prompts and chat.
const openSession = locked(openSessionUnlocked);
function openSessionUnlocked({ file, brain, root, plan, feature }, force) {
  const key = sessionKey(file);
  const state = loadState();
  const existing = state.sessions[key];
  const now = new Date().toISOString();
  if (existing && !force && existing.status === "ended" && existing.ended_by === "user")
    return { session: existing, refused: true, reason: "user ended this review session; re-run with --reopen to continue it" };
  // Queued or unacked feedback belongs to the brain that opened the session:
  // re-binding it to another brain would record it there (or twice).
  if (existing && hasPendingFeedback(existing) && existing.brain && brain && existing.brain !== brain)
    return { session: existing, conflict: true };
  const session = existing || { key, prompts: [], dom_snapshot: "", chat: [] };
  Object.assign(session, { file, brain, root, plan: plan || session.plan || null, feature: feature || null,
    url: sessionUrl(key), status: "open", ended_by: null, updated_at: now });
  state.sessions[key] = session;
  saveState(state);
  return { session, refused: false };
}

// Append prompts. `end` closes the session without dropping the batch — it
// still rides out on the next takeFeedback() drain.
function queueFeedback(key, { prompts, end, endedBy, domSnapshot }) {
  return mutateSession(key, (s) => {
    s.prompts.push(...(prompts || []));
    if (domSnapshot !== undefined) s.dom_snapshot = domSnapshot;
    if (end) (s.status = "ended"), (s.ended_by = endedBy || "user");
    else s.status = "feedback";
  });
}

// Hand out the next feedback batch, or null when none is pending. Delivery is
// at-least-once: the batch moves to `s.inflight` with a batch id instead of
// being deleted, and only the CLI's POST /api/ack (sent after it recorded the
// round in brain.db) removes it. A poll that dies between fetch and record
// therefore gets the SAME batch (same id) on the next poll; the CLI's batch-id
// guard keeps a re-delivery from becoming a second round. While a batch is
// in flight, newer prompts wait in `s.prompts` for the batch after it. A batch
// sent with the end carries session_ended so the poll can report both at once.
const takeFeedback = locked(takeFeedbackUnlocked);
function takeFeedbackUnlocked(key) {
  const state = loadState();
  const s = state.sessions[key];
  if (!s) return null;
  if (s.inflight && Array.isArray(s.inflight.prompts)) {
    s.inflight.deliveries = (s.inflight.deliveries || 1) + 1;
    s.updated_at = new Date().toISOString();
    saveState(state);
    // The End reported is the session's CURRENT one, not the batch's saved
    // flag: a user End that landed after the first delivery must reach the
    // agent now, and a session reopened since then stays open (the old
    // batch's end must not close it). Newer queued prompts carry the End
    // instead, so the agent keeps polling until it has them.
    const endedNow = s.status === "ended" && !(Array.isArray(s.prompts) && s.prompts.length);
    return { ...s.inflight, session_ended: endedNow, ended_by: endedNow ? s.ended_by : null, redelivered: true };
  }
  if (!Array.isArray(s.prompts) || !s.prompts.length) return null;
  const ended = s.status === "ended";
  // The DOM outline travels with its batch: a later batch overwrites
  // s.dom_snapshot, and a re-delivery must not pair old prompts with it.
  s.inflight = { batch: crypto.randomUUID(), prompts: s.prompts, dom_snapshot: s.dom_snapshot || "",
    session_ended: ended, ended_by: ended ? s.ended_by : null, deliveries: 1 };
  s.prompts = [];
  if (!ended) s.status = "open";
  s.updated_at = new Date().toISOString();
  saveState(state);
  return { ...s.inflight, redelivered: false };
}

// The CLI recorded batch `batch` in brain.db: forget it. Idempotent — an
// unknown or already-acked id is a no-op (returns false).
const ackFeedback = locked(ackFeedbackUnlocked);
function ackFeedbackUnlocked(key, batch) {
  const state = loadState();
  const s = state.sessions[key];
  if (!s || !s.inflight || s.inflight.batch !== batch) return false;
  delete s.inflight;
  s.updated_at = new Date().toISOString();
  saveState(state);
  return true;
}

function endSession(key, endedBy) {
  return mutateSession(key, (s) => {
    // A user's End latches until an explicit --reopen: a later agent end
    // must not downgrade it (openSession would then reopen without asking).
    if (s.status === "ended" && s.ended_by === "user") return;
    s.status = "ended";
    s.ended_by = endedBy;
  });
}

function addChat(key, role, text) {
  return mutateSession(key, (s) => {
    s.chat.push({ role, text, at: new Date().toISOString() });
  });
}

function setLayoutWarnings(key, warnings) {
  return mutateSession(key, (s) => {
    s.layout_warnings = Array.isArray(warnings) ? warnings : [];
  });
}

function markLayoutKeysDelivered(key, keys) {
  return mutateSession(key, (s) => {
    s.delivered_layout_keys = [...new Set([...(s.delivered_layout_keys || []), ...(keys || [])])].slice(-100);
  });
}

// Screenshot pins from the watch dashboard's lightbox: { id, shot, x, y, note,
// at, shotSha256, sentAt }. `shot` is a recorded shot path (repo-relative);
// `superseded` is computed on read (context.js) from the hash.
const pinsKey = (brainDir, feature) => `${brainDir}::${feature}`;

function listPins(brainDir, feature) {
  return loadState().pins[pinsKey(brainDir, feature)] || [];
}

// Read-only view of the pin store for the CLI (`brain verifications view`,
// `brain context`): the server stays the only writer. Pins of `feature`, or of
// every feature of the brain when `feature` is omitted, each with `feature`
// and the read-time `superseded` / `sentAt` fields. Never creates the state
// dir; a missing or corrupt store reads as no pins. `filter` (pin -> bool,
// pin already tagged with `feature`) drops pins BEFORE their shots are hashed.
export function readPins(brainDir, feature, { mainRoot, filter } = {}) {
  const prefix = `${brainDir}::`;
  const pins = Object.entries(loadState(stateDirPath()).pins)
    .filter(([k, list]) => k.startsWith(prefix) && Array.isArray(list) && (feature == null || k === pinsKey(brainDir, feature)))
    .flatMap(([k, list]) => list.filter((a) => a && typeof a === "object").map((a) => ({ ...a, feature: k.slice(prefix.length) })))
    .filter((a) => !filter || filter(a));
  return withSuperseded(pins, mainRoot || path.dirname(brainDir));
}

const updatePins = locked(updatePinsUnlocked);
function updatePinsUnlocked(brainDir, feature, fn) {
  const state = loadState();
  const k = pinsKey(brainDir, feature);
  const out = fn(state.pins[k] || []);
  state.pins[k] = out.list;
  saveState(state);
  return out.result;
}

// ---------------------------------------------------------------------------
// Brain handles — one open brain.db per brain dir, reused across requests.
// lib/brain resolves worktrees to the main checkout's .brain.
// ---------------------------------------------------------------------------

const brains = new Map(); // brainDir -> { db, root, brainDir, dbPath, ino }

function inodeOf(p) {
  try {
    return fs.statSync(p).ino;
  } catch {
    return null;
  }
}

// `brain` (absolute .brain path) wins; else walk up from `start`. `root` is
// the checkout plan paths are relative to (the CLI passes its own, so a
// worktree resolves plan files against itself); `mainRoot` is the main
// checkout shot paths are relative to (shots live in its .brain/shots/).
// Throws BrainError.
function brainAt({ brain, start, root } = {}) {
  const loc = L.locate(start || (brain ? path.dirname(brain) : process.cwd()), brain ? { brain } : {});
  let h = brains.get(loc.brainDir);
  // A brain.db replaced on disk (rebuilt, re-imported) gets a fresh handle,
  // and pages bound to it refetch.
  if (h && inodeOf(h.dbPath) !== h.ino) {
    dropBrain(loc.brainDir);
    notifyBrain(loc.brainDir);
    h = null;
  }
  if (!h) {
    const opened = L.openBrain(start || path.dirname(loc.brainDir), { brain: loc.brainDir });
    h = { db: opened.db, root: opened.root, mainRoot: opened.mainRoot, brainDir: opened.brainDir, dbPath: opened.dbPath, ino: inodeOf(opened.dbPath) };
    brains.set(loc.brainDir, h);
    startBrainTicker(); // also sweeps idle handles when no page is bound (headless review)
  }
  h.lastUsed = Date.now();
  const r = root && path.isAbsolute(root) && fs.existsSync(root) ? root : loc.root;
  return { ...h, root: r };
}

function brainForSession(session) {
  return brainAt({ brain: session.brain, start: path.dirname(session.file), root: session.root });
}

// BrainError -> HTTP JSON { error, code, help }.
function sendBrainError(res, status, e) {
  if (!L.isBrainError(e)) throw e;
  sendJSON(res, status, { error: e.message, code: e.code, help: (e.help || []).join(" · ") });
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// next_step guidance — single source of truth for poll response copy
// ---------------------------------------------------------------------------

export const NEXT_STEP = {
  feedback:
    'Apply the requested changes to the artifact file, then run `brain review poll <file> --agent-reply "what you changed"` to continue the loop. Keep the poll running; do not background-and-forget it.',
  feedback_ended_user:
    "The user ended the session. Apply remaining feedback, then report in conversation. Do NOT reopen the browser unless the user asks (then use --reopen).",
  ended_user:
    "The user ended the session. Report in conversation. Do NOT reopen the browser unless the user asks (then use --reopen).",
  ended_agent: "Session closed by agent. Reopen anytime with `brain review <file>`.",
  missing: "No session for this file. Run `brain review <file>` first.",
  layout_error:
    "A layout issue was detected (see layout_warnings). Fix it, save, and wait for the next poll to confirm a clean audit. If the SAME warning comes back marked persistent, proceed with the plan and mention the issue to the human instead of looping on it.",
};

// ---------------------------------------------------------------------------
// Small HTTP helpers
// ---------------------------------------------------------------------------

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function notFound(res, extra = {}) {
  sendJSON(res, 404, { error: "not found", ...extra });
}

function readJSONBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("request body exceeds 2MB limit"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// Same-origin guard for browser-facing state-changing POSTs. Origin/Referer
// absent (CLI callers have no browser headers) always passes; present, it
// must match this server's own Host.
function isSameOrigin(req) {
  const host = req.headers.host;
  const check = (value) => {
    if (!value) return true;
    try {
      return new URL(value).host === host;
    } catch {
      return false;
    }
  };
  return check(req.headers.origin) && check(req.headers.referer);
}

function debounce(fn, ms) {
  let timer = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };
}

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
  ".md": "text/markdown",
};

// Serve `rel` under `root`, refusing to escape it (resolve + realpath
// containment). 404 on any miss, escape, or unlisted extension.
function serveSandboxed(res, root, rel) {
  if (!rel) return notFound(res);
  const rootResolved = path.resolve(root);
  const target = path.resolve(rootResolved, rel);
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) return notFound(res);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return notFound(res);
  let realTarget, realRoot;
  try {
    realTarget = fs.realpathSync(target);
    realRoot = fs.realpathSync(rootResolved);
  } catch {
    return notFound(res);
  }
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) return notFound(res);
  const ext = path.extname(realTarget).toLowerCase();
  const type = MIME_TYPES[ext];
  if (!type) return notFound(res);
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
  streamFile(res, realTarget);
}

// A file removed or made unreadable after the checks above must not crash
// the server: a stream error ends just this response.
function streamFile(res, file) {
  fs.createReadStream(file)
    .on("error", () => res.destroy())
    .pipe(res);
}

// A shot is served only when its path is recorded in brain.db (a shots row on
// some verification) — never an arbitrary file. Shot paths are relative to the
// main checkout; serveSandboxed's own resolve+realpath containment still keeps
// it inside that root.
function serveRecordedShot(res, h, rel, feature = null) {
  if (!rel || rel.split("/").includes("..") || !isRecordedShot(h.db, rel, feature)) return notFound(res);
  serveSandboxed(res, h.mainRoot, rel);
}

function serveStaticFile(res, absPath) {
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) return notFound(res);
  const ext = path.extname(absPath).toLowerCase();
  const type = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
  streamFile(res, absPath);
}

// ---------------------------------------------------------------------------
// SSE registry + broadcast
// ---------------------------------------------------------------------------

const sseClients = new Map(); // key -> Set<ServerResponse>
let sseCount = 0;

function addSSEClient(key, res) {
  if (!sseClients.has(key)) sseClients.set(key, new Set());
  sseClients.get(key).add(res);
  sseCount++;
  refreshIdleTimer();
}

function removeSSEClient(key, res) {
  const set = sseClients.get(key);
  if (!set) return;
  if (set.delete(res)) {
    sseCount--;
    refreshIdleTimer();
  }
  const roots = keyRoots.get(key);
  if (roots) roots.delete(res);
  if (set.size === 0) {
    sseClients.delete(key);
    keyBrains.delete(key); // last client gone: nothing left to notify
    keyRoots.delete(key);
  }
}

function broadcastSSE(key, event, data) {
  const set = sseClients.get(key);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      // client gone; its 'close' handler will clean it up
    }
  }
}

// Broadcast to every connected client across every session key — used for
// shutdown/version-mismatch (v6.5): every open chrome tab gets one last
// chance to notice before the process exits.
function broadcastAllSSE(event, data) {
  for (const key of sseClients.keys()) broadcastSSE(key, event, data);
}

// ---------------------------------------------------------------------------
// Presence machine: listening (poll attached) / working (feedback pending,
// no poll attached) / waiting (neither). Recomputed on poll attach/detach and
// on feedback delivery; broadcasts agent-presence only when the value changes.
// ---------------------------------------------------------------------------

const pollWaiters = new Map(); // key -> count of attached long-poll waiters
const lastPresence = new Map(); // key -> last broadcast presence value

function computePresence(key) {
  if ((pollWaiters.get(key) || 0) > 0) return "listening";
  const session = getSession(key);
  if (session && Array.isArray(session.prompts) && session.prompts.length > 0) return "working";
  return "waiting";
}

function recomputePresence(key) {
  const next = computePresence(key);
  if (lastPresence.get(key) !== next) {
    lastPresence.set(key, next);
    broadcastSSE(key, "agent-presence", { state: next });
  }
}

function attachWaiter(key) {
  pollWaiters.set(key, (pollWaiters.get(key) || 0) + 1);
  pollCount++;
  refreshIdleTimer();
  recomputePresence(key);
}

function detachWaiter(key) {
  const n = (pollWaiters.get(key) || 0) - 1;
  if (n > 0) pollWaiters.set(key, n);
  else pollWaiters.delete(key);
  pollCount--;
  refreshIdleTimer();
  recomputePresence(key);
}

// ---------------------------------------------------------------------------
// Long-poll waiter wake registry (per session key)
// ---------------------------------------------------------------------------

const waiterEvents = new EventEmitter();
waiterEvents.setMaxListeners(0);

function wake(key) {
  waiterEvents.emit(key);
}

// ---------------------------------------------------------------------------
// Idle shutdown: two liveness sets (SSE clients, in-flight polls). A 30-min
// unref'd timer (re)arms whenever both are empty; refreshed on every
// connect/disconnect. BRAIN_AXI_IDLE_TIMEOUT_MS=0 or "off" disables it.
// ---------------------------------------------------------------------------

let pollCount = 0;
let idleTimer = null;

function idleTimeoutMs() {
  const raw = process.env.BRAIN_AXI_IDLE_TIMEOUT_MS;
  if (raw === undefined || raw === "") return 30 * 60 * 1000;
  if (raw === "0" || raw.toLowerCase() === "off") return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 30 * 60 * 1000;
}

function clearIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function armIdleTimer() {
  clearIdleTimer();
  const ms = idleTimeoutMs();
  if (ms <= 0) return;
  idleTimer = setTimeout(() => {
    process.stderr.write("brain-axi: idle timeout reached with no browser or poll connections, shutting down\n");
    process.exit(0);
  }, ms);
  idleTimer.unref();
}

// v6.5: a separate, much shorter shutdown — when every known session is
// ended AND nothing is connected, there is no reason to keep the process
// alive for the full 30-min idle window. 5s grace (not immediate) so a
// connection landing a beat later (e.g. a reopen racing the end) cancels it.
let allEndedTimer = null;

function clearAllEndedTimer() {
  if (allEndedTimer) {
    clearTimeout(allEndedTimer);
    allEndedTimer = null;
  }
}

function armAllEndedTimerIfIdle() {
  if (sseCount === 0 && pollCount === 0) {
    let sessions;
    try {
      sessions = listSessions();
    } catch {
      sessions = [];
    }
    if (sessions.length > 0 && sessions.every((s) => s.status === "ended")) {
      if (!allEndedTimer) {
        allEndedTimer = setTimeout(() => {
          process.stderr.write("brain-axi: all sessions ended and nothing connected, shutting down\n");
          process.exit(0);
        }, 5000);
        if (allEndedTimer.unref) allEndedTimer.unref();
      }
      return;
    }
  }
  clearAllEndedTimer();
}

function refreshIdleTimer() {
  if (sseCount === 0 && pollCount === 0) armIdleTimer();
  else clearIdleTimer();
  armAllEndedTimerIfIdle();
}

// ---------------------------------------------------------------------------
// Change notification. The artifact file is watched (150ms debounce → SSE
// "reload"). Brain changes are seen through SQLite itself: every SSE key that
// renders brain data is bound to a brain dir, and a 1s ticker compares each
// bound brain.db's PRAGMA data_version (bumped by any other connection's
// commit — the CLI's writes) and sends "context-update" on a change.
// ---------------------------------------------------------------------------

const watchersByKey = new Map(); // key -> { artifactPath, watcher }

function teardownWatchers(key) {
  const existing = watchersByKey.get(key);
  if (!existing) return;
  try {
    existing.watcher.close();
  } catch {
    // already closed
  }
  watchersByKey.delete(key);
}

function setupWatchers(key, session) {
  const existing = watchersByKey.get(key);
  if (existing && existing.artifactPath === session.file) return;
  teardownWatchers(key);
  const reloadDebounced = debounce(() => broadcastSSE(key, "reload", {}), 150);
  // Watch the artifact's parent directory filtered by basename, not the file
  // itself: editors and agents commonly save via atomic rename (write temp +
  // rename over), which permanently detaches an fs.watch bound to the inode.
  const artifactBase = path.basename(session.file);
  try {
    const watcher = fs.watch(path.dirname(session.file), (eventType, filename) => {
      // filename can be null on some platforms — fall back to reloading.
      if (filename && filename !== artifactBase) return;
      reloadDebounced();
    });
    watchersByKey.set(key, { artifactPath: session.file, watcher });
  } catch (e) {
    process.stderr.write(`brain-axi: could not watch artifact ${session.file}: ${e.message}\n`);
  }
}

const keyBrains = new Map(); // SSE key -> brainDir whose changes it renders
// SSE key -> Map(client res -> checkout that page checks plan files in). Per
// client, not per key: two dashboards of one feature opened from different
// worktrees share a key but each watch their own checkout's plan files.
const keyRoots = new Map();
const dataVersions = new Map(); // brainDir -> last seen PRAGMA data_version
let brainTicker = null;

function dataVersion(brainDir) {
  const h = brains.get(brainDir);
  if (!h) return undefined;
  try {
    return h.db.prepare("PRAGMA data_version").get().data_version;
  } catch {
    return undefined;
  }
}

// Checkouts whose plan files the pages bound to `h` check (h.root if none).
function rootsOf(h) {
  const roots = new Set();
  for (const [key, bd] of keyBrains) if (bd === h.brainDir) for (const r of (keyRoots.get(key) || new Map()).values()) roots.add(r);
  return roots.size ? [...roots].sort() : [h.root];
}

// `res` binds that one client's checkout; without it (a reopen) every client
// of the key moves to `root`.
function bindBrain(key, brainDir, root, res) {
  keyBrains.set(key, brainDir);
  if (!keyRoots.has(key)) keyRoots.set(key, new Map());
  const roots = keyRoots.get(key);
  if (res) {
    if (root) roots.set(res, root);
    else roots.delete(res);
  } else if (root) for (const c of roots.keys()) roots.set(c, root);
  else roots.clear();
  // Baseline now, not on the first tick: a commit landing in between must
  // still count as a change.
  if (!dataVersions.has(brainDir)) dataVersions.set(brainDir, dataVersion(brainDir));
  const h = brains.get(brainDir);
  const sig = !fileSigs.has(brainDir) && h ? brainSig(h) : undefined;
  if (sig !== undefined) fileSigs.set(brainDir, sig);
  startBrainTicker();
}

function startBrainTicker() {
  if (brainTicker) return;
  brainTicker = setInterval(brainTick, Number(process.env.BRAIN_AXI_DB_POLL_MS) || 1000);
  brainTicker.unref();
}

// Forget a brain's handle AND every cache derived from it: a replaced
// brain.db must not reuse the old file's data_version, shot list or
// signature (the new connection's counter can coincide with the old one's).
function dropBrain(brainDir) {
  const h = brains.get(brainDir);
  if (h) L.close(h.db);
  brains.delete(brainDir);
  dataVersions.delete(brainDir);
  fileSigs.delete(brainDir);
  recordedPaths.delete(brainDir);
}

function notifyBrain(brainDir) {
  for (const [key, bd] of keyBrains) if (bd === brainDir) broadcastSSE(key, "context-update", {});
}

// Recorded files can change with no brain.db write (a re-capture over the
// same path, an edited or deleted plan or plan snapshot) — and pin
// `superseded` / file health (healthChecks) read their bytes. A cheap
// size+mtime signature per brain catches that: shots in the main checkout,
// plans and snapshots in every checkout a bound page checks them in.
// The distinct recorded paths are re-read only when data_version moves, so
// an idle tab costs one stat per FILE per tick, not a query plus one stat per
// historical row.
const fileSigs = new Map(); // brainDir -> signature of its recorded files
const recordedPaths = new Map(); // brainDir -> { v: data_version, shots, plans: [rel paths] }
const distinct = (db, sql) => db.prepare(sql).all().map((r) => r.p);
function fileSig(h, v = dataVersion(h.brainDir), roots = rootsOf(h)) {
  try {
    let cached = recordedPaths.get(h.brainDir);
    if (!cached || cached.v !== v || v === undefined) {
      cached = {
        v,
        shots: distinct(h.db, "SELECT DISTINCT path AS p FROM shots ORDER BY p"),
        plans: distinct(
          h.db,
          "SELECT file_path AS p FROM plans UNION SELECT snapshot_path FROM review_rounds WHERE snapshot_path IS NOT NULL ORDER BY p"
        ),
      };
      recordedPaths.set(h.brainDir, cached);
    }
    const files = [...cached.shots.map((rel) => path.resolve(h.mainRoot, rel)), ...roots.flatMap((r) => cached.plans.map((rel) => path.resolve(r, rel)))];
    return files
      .map((abs) => {
        try {
          const st = fs.statSync(abs);
          return `${abs}:${st.size}:${st.mtimeMs}`;
        } catch {
          return `${abs}:-`;
        }
      })
      .join("|");
  } catch {
    return undefined;
  }
}

// Pins live in the shared sessions.json, not brain.db: a server on another
// port can change them with no write this server sees. Each tick adds the
// brain's pins to its signature, re-reading the store only when its
// size/mtime moved (other session writes then leave the signature as is).
let pinStore = { stamp: null, pins: {} };
function pinSig(brainDir) {
  let stamp = "-";
  try {
    const st = fs.statSync(statePath(stateDirPath()));
    stamp = `${st.size}:${st.mtimeMs}`;
  } catch {
    // no store yet: no pins
  }
  if (stamp !== pinStore.stamp) pinStore = { stamp, pins: loadState(stateDirPath()).pins };
  const prefix = `${brainDir}::`;
  return JSON.stringify(Object.entries(pinStore.pins).filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)));
}

// Everything a bound page renders that can change without a brain.db commit.
function brainSig(h, v) {
  const files = fileSig(h, v);
  return files === undefined ? undefined : `${files}\n${pinSig(h.brainDir)}`;
}

// A brain no page is bound to, untouched for BRAIN_IDLE_MS, is closed (the
// next request reopens it): visiting many repos must not pile up handles.
const BRAIN_IDLE_MS = 5 * 60 * 1000;
function sweepIdleBrains(now = Date.now()) {
  const bound = new Set(keyBrains.values());
  for (const [brainDir, h] of brains) {
    if (bound.has(brainDir) || now - (h.lastUsed || 0) < BRAIN_IDLE_MS) continue;
    dropBrain(brainDir);
  }
}

function brainTick() {
  const changed = new Set();
  for (const brainDir of new Set(keyBrains.values())) {
    // brain.db replaced on disk (restored, re-imported): the cached handle
    // still reads the old file, whose data_version never moves again. Drop
    // it (the next brainAt() reopens) and tell pages to refetch.
    let h = brains.get(brainDir);
    if (h && inodeOf(h.dbPath) !== h.ino) {
      dropBrain(brainDir);
      changed.add(brainDir);
      continue;
    }
    // A bound brain with no handle: a page's refetch landed while brain.db
    // was briefly absent (mid-restore) and failed, so nothing will reopen it.
    // Retry here; once it opens, the pages refetch the restored file.
    if (!h) {
      try {
        h = brains.get(brainAt({ brain: brainDir }).brainDir);
      } catch {
        continue; // still missing (or unreadable): try again next tick
      }
      if (!h) continue;
      changed.add(brainDir);
    }
    const v = dataVersion(brainDir);
    if (v === undefined) continue;
    // A fresh handle (no baseline yet) only takes its baseline.
    if (dataVersions.has(brainDir) && dataVersions.get(brainDir) !== v) changed.add(brainDir);
    dataVersions.set(brainDir, v);
    const sig = h ? brainSig(h, v) : undefined;
    if (sig === undefined) continue;
    if (fileSigs.has(brainDir) && fileSigs.get(brainDir) !== sig) changed.add(brainDir);
    fileSigs.set(brainDir, sig);
  }
  for (const [key, brainDir] of keyBrains) if (changed.has(brainDir)) broadcastSSE(key, "context-update", {});
  sweepIdleBrains();
}

// ---------------------------------------------------------------------------
// Prompt normalization — the ONLY prompt shape agents ever see. Deep-strips
// to exactly {prompt, tag, selector, text, target}, dropping client-only
// fields (queueKey, uid, ...) and capping lengths.
// ---------------------------------------------------------------------------

const VALID_TAGS = ["element", "text", "message", "screenshot", "reference-image", "decision", "diagram-node", "list-edit"];

function capString(v, max) {
  if (typeof v !== "string") return "";
  return v.length > max ? v.slice(0, max) : v;
}

function normalizeTextEndpoint(v) {
  v = v && typeof v === "object" ? v : {};
  return {
    selector: capString(v.selector, 300),
    path: Array.isArray(v.path) ? v.path.filter((n) => Number.isInteger(n)) : [],
    offset: Number.isInteger(v.offset) ? v.offset : 0,
  };
}

function normalizeTarget(tag, target) {
  target = target && typeof target === "object" ? target : {};
  if (tag === "element") return { type: "element" };
  if (tag === "text") {
    return {
      type: "text",
      commonAncestorSelector: capString(target.commonAncestorSelector, 300),
      start: normalizeTextEndpoint(target.start),
      end: normalizeTextEndpoint(target.end),
    };
  }
  if (tag === "screenshot") {
    // x/y are pin percentages (0-100) of the rendered image; null when the
    // annotation carries no pin. note is the reviewer's pin note.
    const clampPct = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Number(v))) : null);
    return {
      type: "screenshot",
      shot: capString(target.shot, 300),
      x: clampPct(target.x),
      y: clampPct(target.y),
      note: capString(target.note, 2000),
    };
  }
  if (tag === "reference-image") {
    // A pin dropped on a reference <img> embedded in the artifact. `selector`
    // is the cssPath locator the agent uses to find the img in the artifact
    // source (the src itself may be an unusable data: URI). x/y are pin
    // percentages (0-100), null when the annotation carries no pin.
    const clampPct = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Number(v))) : null);
    return {
      type: "reference-image",
      selector: capString(target.selector, 300),
      alt: capString(target.alt, 300),
      x: clampPct(target.x),
      y: clampPct(target.y),
      note: capString(target.note, 2000),
    };
  }
  if (tag === "decision")
    return {
      type: "decision",
      question: capString(target.question, 200),
      choice: capString(target.choice, 200),
    };
  if (tag === "diagram-node")
    return {
      type: "diagram-node",
      diagramId: capString(target.diagramId, 200),
      nodeId: capString(target.nodeId, 200),
      label: capString(target.label, 200),
    };
  if (tag === "list-edit")
    return {
      type: "list-edit",
      section: capString(target.section, 100),
      action: ["add", "remove", "edit"].includes(target.action) ? target.action : "edit",
      item: capString(target.item, 500),
      index: Number.isInteger(target.index) ? target.index : null,
    };
  return { type: "message" };
}

function normalizePrompt(raw) {
  raw = raw && typeof raw === "object" ? raw : {};
  const tag = VALID_TAGS.includes(raw.tag) ? raw.tag : "message";
  return {
    prompt: capString(raw.prompt, 4000),
    tag,
    selector: capString(raw.selector, 300),
    text: capString(raw.text, 400),
    target: normalizeTarget(tag, raw.target),
    // Source-excerpt passthrough from the browser (the SDK sends a snippet
    // of the annotated node's HTML). Client-supplied, capped, never trusted
    // beyond that. `line` is the opposite of this field — see
    // resolveAnchorLines below — and is deliberately NOT accepted here: any
    // client-supplied `raw.line` is ignored, full stop.
    html: capString(raw.html, 300),
  };
}

function normalizePrompts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizePrompt);
}

// ---------------------------------------------------------------------------
// Prompt anchors (v6.6) — server-resolved `line`, computed once per poll
// drain by reading the session's CURRENT artifact file. Never client-
// supplied. Cheap (one read per drain) and never throws: a missing/unreadable
// artifact just yields line: null for every prompt in the batch.
// ---------------------------------------------------------------------------

function bestAnchor(p) {
  if (p.text) return p.text;
  if (p.target && p.target.type === "list-edit" && p.target.item) return p.target.item;
  if (p.target && p.target.type === "diagram-node" && p.target.label) return p.target.label;
  return null;
}

function collapseWs(s) {
  return s.replace(/\s+/g, " ").trim();
}

// 1-based line of the first occurrence of `anchor` in `lines`, else null.
// Exact substring match first, then a case-insensitive whitespace-collapsed
// fallback.
// A short anchor ("Yes", "Error") matches all over the file — a wrong line
// hint is worse than none, so refuse to resolve ambiguous anchors: minimum
// length after whitespace collapse, and null when the anchor occurs on more
// than one line (the agent falls back to the selector/text anchors instead).
const MIN_ANCHOR_CHARS = 10;

function linesMatching(lines, matcher) {
  const hits = [];
  for (let i = 0; i < lines.length && hits.length < 2; i++) {
    if (matcher(lines[i])) hits.push(i + 1);
  }
  return hits;
}

function findAnchorLine(lines, anchor) {
  if (!anchor || collapseWs(anchor).length < MIN_ANCHOR_CHARS) return null;
  const exact = linesMatching(lines, (l) => l.includes(anchor));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const needle = collapseWs(anchor).toLowerCase();
  const loose = linesMatching(lines, (l) => collapseWs(l).toLowerCase().includes(needle));
  return loose.length === 1 ? loose[0] : null;
}

function resolveAnchorLines(prompts, filePath) {
  let lines = null;
  try {
    lines = fs.readFileSync(filePath, "utf8").split("\n");
  } catch {
    lines = null;
  }
  return prompts.map((p) => ({ ...p, line: lines ? findAnchorLine(lines, bestAnchor(p)) : null }));
}

// ---------------------------------------------------------------------------
// Layout audit warnings (v6.2 — Addendum v6). Normalized shape:
// {selector, kind: "page-overflow"|"clipped-text", overflowPx, severity:
// "error"|"warning"}. `persistent` is added at delivery time, not stored.
// ---------------------------------------------------------------------------

const VALID_LAYOUT_KINDS = ["page-overflow", "clipped-text"];
const VALID_LAYOUT_SEVERITIES = ["error", "warning"];

function normalizeLayoutWarning(raw) {
  raw = raw && typeof raw === "object" ? raw : {};
  return {
    selector: capString(raw.selector, 300),
    kind: VALID_LAYOUT_KINDS.includes(raw.kind) ? raw.kind : "page-overflow",
    overflowPx: Number.isFinite(raw.overflowPx) ? raw.overflowPx : 0,
    severity: VALID_LAYOUT_SEVERITIES.includes(raw.severity) ? raw.severity : "warning",
  };
}

function normalizeLayoutWarnings(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 10).map(normalizeLayoutWarning);
}

function layoutWarningKey(w) {
  return `${w.kind}:${w.selector}`;
}

// Attach `persistent` (was this exact kind:selector already delivered before
// now?) using the pre-delivery `delivered_layout_keys` set, then mark every
// currently-shown key delivered so the NEXT time it appears it reads
// persistent: true. Returns [] when there is nothing stored.
function deliverLayoutWarnings(key) {
  const session = getSession(key);
  if (!session || !Array.isArray(session.layout_warnings) || session.layout_warnings.length === 0) return [];
  const delivered = new Set(session.delivered_layout_keys || []);
  const out = session.layout_warnings.map((w) => ({ ...w, persistent: delivered.has(layoutWarningKey(w)) }));
  markLayoutKeysDelivered(key, session.layout_warnings.map(layoutWarningKey));
  return out;
}

function hasFreshErrorWarning(session) {
  if (!session || !Array.isArray(session.layout_warnings)) return false;
  const delivered = new Set(session.delivered_layout_keys || []);
  return session.layout_warnings.some((w) => w.severity === "error" && !delivered.has(layoutWarningKey(w)));
}

// ---------------------------------------------------------------------------
// Poll response construction (shared by immediate-return and wake-triggered
// paths). Returns null when there is nothing to report yet (must wait).
// ---------------------------------------------------------------------------

function buildPollResponse(key) {
  const drained = takeFeedback(key);
  if (drained) {
    const session = getSession(key);
    const promptsWithLines = resolveAnchorLines(drained.prompts, session ? session.file : null);
    const base = { status: "feedback", prompts: promptsWithLines, batch: drained.batch };
    if (session && session.brain) base.brain = session.brain; // the CLI records only into this brain
    if (drained.redelivered) base.redelivered = true;
    // v6.1: send the (compact-outline) snapshot string itself when non-empty;
    // otherwise fall back to the old dom_snapshot_chars: 0 shape.
    if (drained.dom_snapshot) base.dom_snapshot = drained.dom_snapshot;
    else base.dom_snapshot_chars = 0;
    const layoutWarnings = deliverLayoutWarnings(key);
    if (layoutWarnings.length) base.layout_warnings = layoutWarnings;
    if (drained.session_ended) {
      base.session_ended = true;
      base.ended_by = drained.ended_by;
      base.next_step = drained.ended_by === "user" ? NEXT_STEP.feedback_ended_user : NEXT_STEP.feedback;
    } else {
      base.next_step = NEXT_STEP.feedback;
    }
    return base;
  }
  const session = getSession(key);
  if (!session) return { status: "missing", next_step: NEXT_STEP.missing };
  if (session.status === "ended") {
    return {
      status: "ended",
      ...(session.brain ? { brain: session.brain } : {}),
      ended_by: session.ended_by,
      next_step: session.ended_by === "user" ? NEXT_STEP.ended_user : NEXT_STEP.ended_agent,
    };
  }
  // v6.2: a fresh error-severity layout warning wakes (or is delivered to) a
  // poll even with no prompts queued.
  if (hasFreshErrorWarning(session)) {
    const layoutWarnings = deliverLayoutWarnings(key);
    return { status: "feedback", prompts: [], layout_warnings: layoutWarnings, next_step: NEXT_STEP.layout_error };
  }
  return null; // open, nothing queued — long-poll
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

// `api` stamps this server's contract with the CLI. The CLI respawns a server
// whose version OR api differs, so a pre-brain.db server left running from the
// same package version is never reused.
export const REVIEW_API = 3;

// One POSIX shell word, for copy-pasteable help.
const shq = (v) => (/^[\w./:@%+=,-]+$/.test(v) ? v : `'${String(v).replace(/'/g, "'\\''")}'`);

function handleHealth(res) {
  sendJSON(res, 200, { ok: true, app: "brain-axi", version: getVersion(), api: REVIEW_API });
}

let cachedVersion = null;
function getVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const pkgPath = path.join(MODULE_DIR, "..", "..", "package.json");
    cachedVersion = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version || "0.0.0";
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion;
}

function handleShutdown(res) {
  // v6.5: give every connected chrome tab a chance to notice before the
  // process disappears (also covers the CLI's version-mismatch respawn path,
  // which shuts this same route down before spawning a fresh server).
  broadcastAllSSE("chrome-reload", {});
  sendJSON(res, 200, { ok: true });
  setImmediate(() => process.exit(0));
}

// POST /api/open {file, plan?, feature?, reopen?, brain?, root?}. The CLI
// registers the plan in brain.db first and passes the brain dir + checkout
// root; this route only validates against the brain (read-only) and opens
// the in-memory session.
async function handleOpen(req, res) {
  if (!isSameOrigin(req)) return sendJSON(res, 403, { error: "cross-origin request refused" });
  let body;
  try {
    body = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, 400, { error: e.message });
  }
  const { file, plan, reopen, feature, brain, root } = body || {};
  if (!file || typeof file !== "string") return sendJSON(res, 400, { error: "file is required" });
  if (brain !== undefined && brain !== null && (typeof brain !== "string" || !path.isAbsolute(brain)))
    return sendJSON(res, 400, { error: "brain must be an absolute .brain path" });

  let real;
  try {
    real = fs.realpathSync(path.resolve(file));
  } catch {
    return sendJSON(res, 404, { error: `file not found: ${path.resolve(file)}`, help: "Pass a path to an existing HTML artifact file" });
  }

  let h;
  try {
    h = brainAt({ brain: brain || undefined, start: path.dirname(real), root });
  } catch (e) {
    return sendBrainError(res, 404, e);
  }

  let featureSlug = null;
  if (feature !== undefined && feature !== null && feature !== "") {
    if (typeof feature !== "string") return sendJSON(res, 400, { error: "feature must be a string" });
    try {
      featureSlug = L.features.lookup(h.db, feature).slug;
    } catch (e) {
      return sendBrainError(res, 400, e);
    }
  }
  const registered = planForFile(h.db, h.root, real);
  const slug = (typeof plan === "string" && plan) || (registered && registered.slug) || null;
  if (!featureSlug && registered && registered.feature) featureSlug = registered.feature;

  const { session, refused, reason, conflict } = openSession(
    { file: real, brain: h.brainDir, root: h.root, plan: slug, feature: featureSlug },
    !!reopen
  );
  if (conflict)
    return sendJSON(res, 409, {
      error: `${real} has unrecorded feedback for the brain at ${session.brain}; it cannot move to ${h.brainDir} yet`,
      help: `Record it first: brain review poll ${shq(real)} --brain ${shq(session.brain)}`,
    });
  if (refused) return sendJSON(res, 200, { refused: true, reason, key: session.key, url: session.url });

  setupWatchers(session.key, session);
  // A tab already open on this session follows the brain (and checkout) it
  // was just (re)opened with, and refetches its sidebar now.
  if (keyBrains.has(session.key)) {
    bindBrain(session.key, h.brainDir, h.root);
    broadcastSSE(session.key, "context-update", {});
  }
  // Opening/reviving a session can flip "all sessions ended" back to false —
  // cancel a pending all-ended shutdown armed by an earlier /api/end.
  refreshIdleTimer();
  sendJSON(res, 200, { key: session.key, url: session.url, status: session.status, plan: session.plan, feature: session.feature || null });
}

function finishPoll(res, result) {
  try {
    res.end(JSON.stringify(result));
  } catch {
    // response already closed
  }
}

function handlePoll(req, res, url) {
  const key = url.searchParams.get("key");
  if (!key) return sendJSON(res, 400, { error: "key is required" });

  const reply = url.searchParams.get("reply");
  if (reply) {
    addChat(key, "agent", reply);
    broadcastSSE(key, "agent-reply", { text: reply, at: new Date().toISOString() });
  }

  const immediate = buildPollResponse(key);
  if (immediate) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return finishPoll(res, immediate);
  }

  // Register as a long-poll waiter: heartbeat every 15s, wake on feedback/end,
  // clean up on client disconnect.
  res.writeHead(200, { "Content-Type": "application/json" });
  attachWaiter(key);

  let done = false;
  const heartbeat = setInterval(() => {
    try {
      res.write(" ");
    } catch {
      cleanup();
    }
  }, 15000);
  if (heartbeat.unref) heartbeat.unref();

  function cleanup() {
    if (done) return;
    done = true;
    clearInterval(heartbeat);
    waiterEvents.removeListener(key, onWake);
    req.removeListener("close", onClose);
    detachWaiter(key);
  }

  function onWake() {
    const result = buildPollResponse(key);
    if (result) {
      cleanup();
      finishPoll(res, result);
    }
  }

  function onClose() {
    cleanup();
  }

  waiterEvents.on(key, onWake);
  req.on("close", onClose);
}

async function handleFeedback(req, res) {
  if (!isSameOrigin(req)) return sendJSON(res, 403, { error: "cross-origin request refused" });
  let body;
  try {
    body = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, 400, { error: e.message });
  }
  const { key, prompts, end, dom_snapshot: domSnapshot } = body || {};
  if (!key) return sendJSON(res, 400, { error: "key is required" });
  const session = getSession(key);
  if (!session) return sendJSON(res, 404, { error: `no session for key ${key}` });
  // Ended sessions must not be revived through the feedback path — that would
  // bypass the user-end latch that only /api/open with reopen may clear.
  if (session.status === "ended")
    return sendJSON(res, 409, { error: "session already ended", help: "Reopen with `brain review <file> --reopen`" });

  const normalized = normalizePrompts(prompts);
  const endedBy = end ? "user" : null;
  const updated = queueFeedback(key, { prompts: normalized, end: !!end, endedBy: endedBy || undefined, domSnapshot });
  if (!updated) return sendJSON(res, 404, { error: `no session for key ${key}` });

  // Nothing is written to the brain here: the CLI records the round when the
  // agent's poll drains this batch (one writer, and the round is exactly what
  // the agent received).

  // Mirror the user's feedback into the conversation history so it survives
  // reloads and shows in the chat thread, not just as transient queue pills.
  for (const p of normalized) {
    const label = p.tag === "message" ? p.prompt : `[${p.tag}] ${p.text ? `"${p.text}" — ` : ""}${p.prompt}`;
    addChat(key, "user", label);
  }
  const synced = getSession(key);
  broadcastSSE(key, "chat-sync", { chat: synced ? synced.chat : [] });

  wake(key);
  recomputePresence(key);
  if (end) refreshIdleTimer(); // v6.5: an end-with-feedback may leave nothing connected
  sendJSON(res, 200, { ok: true, queued: normalized.length });
}

// POST /api/ack {key, batch}: the CLI recorded the polled batch in brain.db.
// Until this arrives the batch stays in flight and is re-delivered.
async function handleAck(req, res) {
  if (!isSameOrigin(req)) return sendJSON(res, 403, { error: "cross-origin request refused" });
  let body;
  try {
    body = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, 400, { error: e.message });
  }
  const { key, batch } = body || {};
  if (!key || typeof batch !== "string" || !batch) return sendJSON(res, 400, { error: "key and batch are required" });
  sendJSON(res, 200, { ok: true, acked: ackFeedback(key, batch) });
}

async function handleEnd(req, res) {
  if (!isSameOrigin(req)) return sendJSON(res, 403, { error: "cross-origin request refused" });
  let body;
  try {
    body = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, 400, { error: e.message });
  }
  const { key, by } = body || {};
  if (!key) return sendJSON(res, 400, { error: "key is required" });
  const endedBy = by === "user" || by === "agent" ? by : "agent";
  endSession(key, endedBy); // idempotent; no-op (still ok:true) if key unknown
  wake(key);
  refreshIdleTimer(); // v6.5: this may have just been the last open session
  sendJSON(res, 200, { ok: true, status: "ended" });
}

// v6.2 — POST /api/layout {key, warnings}. Same-origin guarded (chrome-only).
// Replaces session.layout_warnings wholesale; wakes any attached poll waiter
// when a fresh (never-delivered) error-severity warning is present.
async function handleLayout(req, res) {
  if (!isSameOrigin(req)) return sendJSON(res, 403, { error: "cross-origin request refused" });
  let body;
  try {
    body = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, 400, { error: e.message });
  }
  const { key, warnings } = body || {};
  if (!key) return sendJSON(res, 400, { error: "key is required" });
  const session = getSession(key);
  if (!session) return sendJSON(res, 404, { error: `no session for key ${key}` });

  const normalized = normalizeLayoutWarnings(warnings);
  const delivered = new Set(session.delivered_layout_keys || []);
  const freshError = normalized.some((w) => w.severity === "error" && !delivered.has(layoutWarningKey(w)));

  setLayoutWarnings(key, normalized);
  if (freshError && (pollWaiters.get(key) || 0) > 0) wake(key);

  sendJSON(res, 200, { ok: true });
}

function handleEvents(req, res, key) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  if (res.flushHeaders) res.flushHeaders();

  const session = getSession(key);
  res.write(`event: chat-sync\ndata: ${JSON.stringify({ chat: session ? session.chat : [] })}\n\n`);
  const presence = computePresence(key);
  lastPresence.set(key, presence);
  res.write(`event: agent-presence\ndata: ${JSON.stringify({ state: presence })}\n\n`);
  // The sidebar may have fetched context before this stream existed: one
  // refresh now closes that window (later changes arrive via the ticker).
  res.write(`event: context-update\ndata: {}\n\n`);

  addSSEClient(key, res);
  if (session) {
    try {
      const b = brainForSession(session);
      bindBrain(key, b.brainDir, b.root, res); // sidebar follows brain.db changes
    } catch {
      // brain.db missing right now (mid-restore) but its .brain/ is there:
      // bind anyway so the ticker reopens it and refreshes this sidebar. No
      // .brain/ at all — the sidebar just won't live-update.
      try {
        const loc = L.locate(path.dirname(session.file), session.brain ? { brain: session.brain } : {});
        if (fs.existsSync(loc.brainDir)) bindBrain(key, loc.brainDir, session.root || loc.root, res);
      } catch {
        // unlocatable: nothing to follow
      }
    }
  }
  req.on("close", () => removeSSEClient(key, res));
}

function renderChrome(session, key) {
  const chromePath = path.join(MODULE_DIR, "chrome.html");
  let html = fs.readFileSync(chromePath, "utf8");
  const title = (session && (session.plan || path.basename(session.file))) || key;
  // --plan is caller-supplied free text; escape it so it can't break out of
  // the <title>/text nodes it is substituted into.
  const escaped = String(title).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  html = html.split("{{KEY}}").join(key).split("{{TITLE}}").join(escaped);
  return html;
}

function handleChromePage(res, key) {
  const session = getSession(key);
  if (!session) return notFound(res, { help: "Run `brain review <file>` to open a session first" });
  const html = renderChrome(session, key);
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
}

function injectSdkTag(html, key) {
  const tag = `<script src="/session/${key}/sdk.js" data-brain-ui></script>`;
  const bodyClose = /<\/body\s*>/i;
  if (bodyClose.test(html)) return html.replace(bodyClose, (m) => tag + m);
  return html + tag;
}

// The artifact iframe is the one surface that runs page-authored script NEXT TO
// the review bridge: injectSdkTag puts window.brain.queuePrompt on the same
// global scope the plan's own <script> blocks use. Anything that origin can
// load can therefore read the plan the human is reading and queue review
// prompts as if the human had clicked them.
//
// So no remote origin is allowed. `'self'` covers the injected SDK
// (/session/<key>/sdk.js) and any screenshot the artifact references;
// `'unsafe-inline'` is required because the plan standard mandates inline CSS
// and inline <script> for decision cards — dropping it would break every
// artifact. That is a deliberate line: the artifact's OWN script is trusted
// (an agent wrote it, the human is reviewing it), third-party script is not.
//
// Mermaid: plan artifacts (the brain-plan skill) load Mermaid from a CDN, and
// that import fails under this policy. Rather than a CDN exemption, the review
// server serves a pinned, vendored bundle (vendor/mermaid.min.js, same origin)
// and the injected SDK renders any unrendered <pre class="mermaid"> with it.
// Opened standalone (no CSP), the artifact's own CDN import still works.
const ARTIFACT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

function handleArtifact(res, key) {
  const session = getSession(key);
  if (!session) return notFound(res);
  if (!fs.existsSync(session.file)) return notFound(res, { error: `artifact missing: ${session.file}` });
  const html = fs.readFileSync(session.file, "utf8");
  const injected = injectSdkTag(html, key);
  res.writeHead(200, {
    "Content-Type": "text/html",
    "Content-Security-Policy": ARTIFACT_CSP,
  });
  res.end(injected);
}

function handleContext(res, key) {
  const session = getSession(key);
  if (!session) return notFound(res);
  let h;
  try {
    h = brainForSession(session);
  } catch (e) {
    return sendBrainError(res, 404, e);
  }
  // The CLI may register the plan after the session opened: fall back to a
  // lookup by file path.
  const registered = session.plan ? null : planForFile(h.db, h.root, session.file);
  const context = planContext(h.db, h.root, session.plan || (registered && registered.slug));
  const payload = { ...context, session: { key: session.key, file: session.file, status: session.status } };
  const feature = session.feature || (context.plan && context.plan.feature) || null;
  if (feature) {
    payload.execution = executionContext(h.db, h.root, feature, { annotations: listPins(h.brainDir, feature), mainRoot: h.mainRoot });
    // Where the chrome's ended-state "Watch execution" link points.
    payload.execution.watch_url = "/watch/" + encodeURIComponent(feature) + watchQuery(h);
  }
  sendJSON(res, 200, payload);
}

// GET /session/<key>/health: lib/brain's check rows for the session's brain
// (the chrome sidebar's health strip; /watch serves the same rows).
function handleSessionHealth(res, key) {
  const session = getSession(key);
  if (!session) return notFound(res);
  try {
    const h = brainForSession(session);
    sendJSON(res, 200, { checks: healthChecks(h.db, h.root, h.mainRoot) });
  } catch (e) {
    sendBrainError(res, 404, e);
  }
}

// ---------------------------------------------------------------------------
// /watch surface — the session-less execution dashboard. The brain dir
// arrives as `?brain=<encoded abs .brain path>` on every /watch route; it and
// the feature slug are validated against brain.db before anything is served.
// Loopback-only like the rest of the server; POSTs carry the same-origin guard.
// ---------------------------------------------------------------------------

// { h, feature } or null after sending a 404 JSON { error, code?, help }.
function resolveWatch(res, url, m) {
  const feature = decodeURIComponent(m[1]);
  const brain = url.searchParams.get("brain") || "";
  if (!brain || !path.isAbsolute(brain)) {
    notFound(res, { error: "brain query param must be an absolute .brain path", help: "Open the dashboard via `brain watch <feature>`" });
    return null;
  }
  let h;
  try {
    h = brainAt({ brain, root: watchRoot(url.searchParams.get("root"), brain) });
    return { h, feature: L.features.lookup(h.db, feature).slug };
  } catch (e) {
    if (!L.isBrainError(e)) throw e;
    notFound(res, { error: e.message, code: e.code, help: (e.help || []).join(" · ") });
    return null;
  }
}

// `?root=` — the worktree the dashboard was opened from, so plan files are
// checked there (shots stay in the main checkout). Honored when it is a
// checkout of the same repo as the brain, or any checkout for a brain outside
// git (`--brain` elsewhere: the CLI stamps and checks the caller's checkout);
// anything else falls back to the brain's own root.
function watchRoot(root, brain) {
  if (!root || !path.isAbsolute(root) || !fs.existsSync(root)) return undefined;
  try {
    const mine = L.db.gitRoots(root);
    const theirs = L.db.gitRoots(path.dirname(brain));
    if (!mine) return undefined;
    return !theirs || mine.mainRoot === theirs.mainRoot ? mine.toplevel : undefined;
  } catch {
    return undefined;
  }
}

const watchQuery = (h) =>
  "?brain=" + encodeURIComponent(h.brainDir) + (h.root && h.mainRoot && h.root !== h.mainRoot ? "&root=" + encodeURIComponent(h.root) : "");

const watchKeyFor = (brainDir, feature) => "watch:" + brainDir + ":" + feature;

function handleWatchContext(res, url, m) {
  const w = resolveWatch(res, url, m);
  if (!w) return;
  sendJSON(res, 200, watchContext(w.h.db, w.h.root, w.feature, { annotations: listPins(w.h.brainDir, w.feature), mainRoot: w.h.mainRoot }));
}

function handleWatchShot(res, url, m) {
  const w = resolveWatch(res, url, m);
  if (!w) return;
  serveRecordedShot(res, w.h, decodeURIComponent(m[2]), w.feature);
}

function handleWatchEvents(req, res, url, m) {
  const w = resolveWatch(res, url, m);
  if (!w) return;
  const key = watchKeyFor(w.h.brainDir, w.feature);
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  if (res.flushHeaders) res.flushHeaders();
  // Tell a freshly opened page the channel is live (it fetches context on
  // load anyway; this just confirms the stream).
  res.write(`event: context-update\ndata: {}\n\n`);
  addSSEClient(key, res);
  bindBrain(key, w.h.brainDir, w.h.root, res);
  req.on("close", () => removeSSEClient(key, res));
}

function handleWatchPage(res, url, m) {
  const w = resolveWatch(res, url, m);
  if (!w) return;
  const dashPath = path.join(MODULE_DIR, "dashboard.html");
  if (!fs.existsSync(dashPath)) return sendJSON(res, 503, { error: "dashboard.html missing" });
  const escaped = w.feature.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = fs
    .readFileSync(dashPath, "utf8")
    .split("{{FEATURE}}")
    .join(escaped)
    .split("{{BRAIN}}")
    .join(encodeURIComponent(w.h.brainDir))
    .split("{{ROOT}}")
    .join(w.h.root && w.h.root !== w.h.mainRoot ? encodeURIComponent(w.h.root) : "");
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
}

const capStr = (v, max) => (typeof v !== "string" ? "" : v.length > max ? v.slice(0, max) : v);
const pinPct = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.max(0, Math.min(100, Math.round(Number(v) * 10) / 10)) : null);

// Shared shape of the three pin POSTs: same-origin guard, /watch validation,
// JSON body, then `fn(w, body)` → 200 { ok, ...result } or 400 { error }. A
// successful write nudges the dashboard (pins are not in brain.db, so the
// data_version ticker would not see them).
async function watchPinRoute(req, res, url, m, fn) {
  if (!isSameOrigin(req)) return sendJSON(res, 403, { error: "cross-origin request refused" });
  const w = resolveWatch(res, url, m);
  if (!w) return;
  let body;
  try {
    body = await readJSONBody(req);
  } catch (e) {
    return sendJSON(res, 400, { error: e.message });
  }
  let result;
  try {
    result = fn(w, body || {});
  } catch (e) {
    return sendJSON(res, 400, { error: e.message });
  }
  broadcastSSE(watchKeyFor(w.h.brainDir, w.feature), "context-update", {});
  // Review tabs on the same brain show these pins in their execution panel.
  for (const [key, brainDir] of keyBrains) if (brainDir === w.h.brainDir && !key.startsWith("watch:")) broadcastSSE(key, "context-update", {});
  sendJSON(res, 200, { ok: true, ...result });
}

// POST /watch/<feature>/annotate {shot, x, y, note} — drop a pin on a recorded
// shot of this feature. The shot's hash is kept so a replaced file reads as
// superseded.
function addPin(w, { shot, x, y, note }) {
  if (typeof shot !== "string" || !isRecordedShot(w.h.db, shot, w.feature))
    throw new Error(`no screenshot at ${shot} under feature ${w.feature}`);
  const sha = sha256OfFile(path.resolve(w.h.mainRoot, shot));
  if (!sha) throw new Error(`screenshot ${shot} is missing on disk`);
  const pin = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    shot,
    x: pinPct(x),
    y: pinPct(y),
    note: capStr(note, 2000),
    at: new Date().toISOString(),
    shotSha256: sha,
    sentAt: null,
  };
  updatePins(w.h.brainDir, w.feature, (list) => ({ list: [...list, pin], result: null }));
  return { annotation: { ...pin, superseded: false } };
}

// POST /watch/<feature>/annotate/delete {id}
function removePin(w, { id }) {
  return updatePins(w.h.brainDir, w.feature, (list) => {
    const next = list.filter((a) => a.id !== id);
    if (next.length === list.length) throw new Error(`no annotation "${id}" for feature ${w.feature}`);
    return { list: next, result: {} };
  });
}

// POST /watch/<feature>/annotate/send — stamp sentAt on every unsent pin (the
// composer hand-off). { sent: n }.
function sendPins(w) {
  const at = new Date().toISOString();
  return updatePins(w.h.brainDir, w.feature, (list) => {
    let sent = 0;
    const next = list.map((a) => (a.sentAt ? a : (sent++, { ...a, sentAt: at })));
    return { list: next, result: { sent } };
  });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const ROUTES = [
  { method: "GET", pattern: /^\/health$/, handler: (req, res) => handleHealth(res) },
  {
    method: "POST",
    pattern: /^\/shutdown$/,
    handler: (req, res) => (isSameOrigin(req) ? handleShutdown(res) : sendJSON(res, 403, { error: "cross-origin request refused" })),
  },
  { method: "POST", pattern: /^\/api\/open$/, handler: (req, res) => handleOpen(req, res) },
  { method: "GET", pattern: /^\/api\/poll$/, handler: (req, res, url) => handlePoll(req, res, url) },
  { method: "POST", pattern: /^\/api\/feedback$/, handler: (req, res) => handleFeedback(req, res) },
  { method: "POST", pattern: /^\/api\/ack$/, handler: (req, res) => handleAck(req, res) },
  { method: "POST", pattern: /^\/api\/end$/, handler: (req, res) => handleEnd(req, res) },
  { method: "POST", pattern: /^\/api\/layout$/, handler: (req, res) => handleLayout(req, res) },
  { method: "GET", pattern: /^\/events\/([^/]+)$/, handler: (req, res, url, m) => handleEvents(req, res, m[1]) },
  { method: "GET", pattern: /^\/chrome\.js$/, handler: (req, res) => serveStaticFile(res, path.join(MODULE_DIR, "chrome.js")) },
  { method: "GET", pattern: /^\/lightbox\.js$/, handler: (req, res) => serveStaticFile(res, path.join(MODULE_DIR, "lightbox.js")) },
  { method: "GET", pattern: /^\/vendor\/mermaid\.min\.js$/, handler: (req, res) => serveStaticFile(res, path.join(MODULE_DIR, "vendor", "mermaid.min.js")) },
  { method: "GET", pattern: /^\/session\/([^/]+)\/sdk\.js$/, handler: (req, res, url, m) => serveStaticFile(res, path.join(MODULE_DIR, "sdk.js")) },
  { method: "GET", pattern: /^\/session\/([^/]+)\/artifact$/, handler: (req, res, url, m) => handleArtifact(res, m[1]) },
  { method: "GET", pattern: /^\/session\/([^/]+)\/context$/, handler: (req, res, url, m) => handleContext(res, m[1]) },
  { method: "GET", pattern: /^\/session\/([^/]+)\/health$/, handler: (req, res, url, m) => handleSessionHealth(res, m[1]) },
  {
    method: "GET",
    pattern: /^\/session\/([^/]+)\/asset\/(.+)$/,
    handler: (req, res, url, m) => {
      const session = getSession(m[1]);
      if (!session) return notFound(res);
      serveSandboxed(res, path.dirname(session.file), decodeURIComponent(m[2]));
    },
  },
  {
    method: "GET",
    pattern: /^\/session\/([^/]+)\/shot\/(.+)$/,
    handler: (req, res, url, m) => {
      const session = getSession(m[1]);
      if (!session) return notFound(res);
      let h;
      try {
        h = brainForSession(session);
      } catch {
        return notFound(res);
      }
      serveRecordedShot(res, h, decodeURIComponent(m[2]));
    },
  },
  { method: "GET", pattern: /^\/dashboard\.js$/, handler: (req, res) => serveStaticFile(res, path.join(MODULE_DIR, "dashboard.js")) },
  { method: "GET", pattern: /^\/watch\/([^/]+)\/context$/, handler: (req, res, url, m) => handleWatchContext(res, url, m) },
  // All three patterns are $-anchored (distinct, non-overlapping), so match
  // order is not load-bearing here — kept in most-specific-path-first order
  // anyway per convention.
  { method: "POST", pattern: /^\/watch\/([^/]+)\/annotate\/delete$/, handler: (req, res, url, m) => watchPinRoute(req, res, url, m, removePin) },
  { method: "POST", pattern: /^\/watch\/([^/]+)\/annotate\/send$/, handler: (req, res, url, m) => watchPinRoute(req, res, url, m, sendPins) },
  { method: "POST", pattern: /^\/watch\/([^/]+)\/annotate$/, handler: (req, res, url, m) => watchPinRoute(req, res, url, m, addPin) },
  { method: "GET", pattern: /^\/watch\/([^/]+)\/shot\/(.+)$/, handler: (req, res, url, m) => handleWatchShot(res, url, m) },
  { method: "GET", pattern: /^\/watch-events\/([^/]+)$/, handler: (req, res, url, m) => handleWatchEvents(req, res, url, m) },
  { method: "GET", pattern: /^\/watch\/([^/]+)$/, handler: (req, res, url, m) => handleWatchPage(res, url, m) },
  { method: "GET", pattern: /^\/session\/([^/]+)$/, handler: (req, res, url, m) => handleChromePage(res, m[1]) },
  // The artifact is served at /session/<key>/artifact, so its relative refs
  // (src="img.png", href="css/a.css") resolve here: same sandbox as asset/.
  // Last, so every named session route above wins.
  {
    method: "GET",
    pattern: /^\/session\/([^/]+)\/(.+)$/,
    handler: (req, res, url, m) => {
      const session = getSession(m[1]);
      if (!session) return notFound(res);
      serveSandboxed(res, path.dirname(session.file), decodeURIComponent(m[2]));
    },
  },
];

// The server binds 127.0.0.1 only; a request naming any other Host is a
// DNS-rebinding attempt (a foreign hostname resolved to loopback, whose
// Origin would then "match" that Host) and is refused before any route.
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);
function isLocalHost(host) {
  if (!host) return true; // HTTP/1.0 or a raw client: no name to rebind
  try {
    return LOCAL_HOSTNAMES.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

async function handleRequest(req, res) {
  if (!isLocalHost(req.headers.host)) return sendJSON(res, 421, { error: "unexpected Host; the review server only answers on 127.0.0.1" });
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  } catch {
    return sendJSON(res, 400, { error: "invalid request URL" });
  }
  for (const route of ROUTES) {
    if (route.method !== req.method) continue;
    const m = route.pattern.exec(url.pathname);
    if (!m) continue;
    try {
      await route.handler(req, res, url, m);
    } catch (e) {
      process.stderr.write(`brain-axi: error handling ${req.method} ${url.pathname}: ${e.stack || e.message}\n`);
      if (!res.headersSent) sendJSON(res, 400, { error: e.message || "internal error" });
      else try { res.end(); } catch {}
    }
    return;
  }
  notFound(res);
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

function resolvePort(explicit) {
  if (explicit) return Number(explicit);
  const argIdx = process.argv.indexOf("--port");
  if (argIdx !== -1 && process.argv[argIdx + 1]) return Number(process.argv[argIdx + 1]);
  if (process.env.BRAIN_AXI_PORT) return Number(process.env.BRAIN_AXI_PORT);
  return 4517;
}

export function startServer({ port } = {}) {
  const effectivePort = resolvePort(port);
  // Normalize env so session urls and every other read here agree on the
  // actually-bound port from here on.
  process.env.BRAIN_AXI_PORT = String(effectivePort);

  const server = http.createServer((req, res) => {
    handleRequest(req, res);
  });

  server.on("error", (e) => {
    process.stderr.write(`brain-axi: server error: ${e.message}\n`);
    process.exit(1);
  });

  server.listen(effectivePort, "127.0.0.1", () => {
    process.stderr.write(`brain-axi review server listening on http://127.0.0.1:${effectivePort}\n`);
  });

  refreshIdleTimer(); // nothing connected yet — arm the idle countdown
  return server;
}

let isMain = false;
try {
  isMain = fs.realpathSync(process.argv[1] || "") === fileURLToPath(import.meta.url);
} catch {
  isMain = false;
}
if (isMain) startServer();
