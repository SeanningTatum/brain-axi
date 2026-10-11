# brain review + brain watch — architecture & contracts

Two browser surfaces on top of the brain:

- **review** — an agent writes a plan as HTML, opens it in the user's browser, long-polls
  for annotations, applies them, and loops until the plan is approved.
- **watch** — a live, read-only execution dashboard for one feature: run steps,
  verifications, checkpoints, screenshots, PR, harness health.

Both are served by one loopback HTTP server, `lib/review/server.js`. Storage is
`brain.db` through `lib/brain` — the server never reads `.brain/` files. This document is
the contract between the server, the CLI and the static assets; change a shape here and
everywhere.

## Layers and files

```
bin/brain.js                review open|poll|end, watch — HTTP client + the ONE brain.db writer
lib/review/server.js        HTTP routes, sessions, long-poll, SSE, change detection; exports
                            startServer, stateDir, sessionKey, REVIEW_API
lib/review/context.js       read-only payload builders over lib/brain (planContext,
                            executionContext, watchContext, runSteps, healthChecks, planForFile)
lib/review/chrome.html|js   review chrome: artifact iframe, composer, brain sidebar
lib/review/sdk.js           injected into the artifact: window.brain.queuePrompt, annotate mode
lib/review/dashboard.html|js  the /watch page
lib/review/lightbox.js      shared screenshot carousel + pins (chrome and dashboard)
lib/review/vendor/mermaid.min.js  pinned Mermaid, served same-origin (artifact CSP has no CDN)
lib/brain/                  storage: plans, review_rounds, review_prompts, features, run_steps,
                            checkpoints, verifications, shots, check()
```

Node >= 24 ESM, zero runtime dependencies, no build step. Browser files are plain ES2020.

## Who writes what

| Data | Owner | Where |
|---|---|---|
| plan row (path, sha256, title, feature, status) | CLI `review open` / `poll` (hash refresh) | brain.db `plans` |
| review round + prompts | CLI `review poll`, when it receives a feedback batch (deduped by `batch_id`) | `review_rounds`, `review_prompts` |
| session open/closed, approval | CLI `review open` / `end [--approved-by]`; `poll` closes a user-ended session | `plans.session_*`, `status`, `approved_by` |
| pending prompts, in-flight batch, chat, DOM snapshot, layout warnings | server | `<stateDir>/sessions.json` |
| screenshot pins (watch lightbox) | server | `<stateDir>/sessions.json` (`pins`)¹ |
| run steps, verifications, shots, checkpoints, features | CLI (other commands) | brain.db |

¹ Pre-0.3 pins (`features/<slug>/screenshots/annotations.json`) are not imported: they
lived in markdown brains, which this version refuses (`LEGACY_BRAIN`: pin
`brain-axi@0.2.0` for that repo, or move the old `.brain/` aside and `brain init`), so no
brain the server can open carries them.

The server opens brain.db read-only in practice (one cached handle per brain dir,
reopened if the file is replaced). A round is recorded when the agent's poll receives it,
so the round history is exactly what the agent saw; prompts wait in the server until then
(Ctrl-C on a poll loses nothing). Delivery is at-least-once with an ack: a poll moves the
queued prompts (and the DOM outline sent with them) into `inflight`
`{batch, prompts, dom_snapshot, session_ended, ended_by, deliveries}`
instead of deleting them; the CLI records the round with that `batch` id, then
`POST /api/ack`s it, and only the ack deletes the batch. A poll killed before the ack gets
the same batch again (`redelivered: true`); `plans.addRound({batchId})` skips a batch id
already recorded for the plan (migration `002`, unique `(plan_id, batch_id)`), so one batch
is one round. A re-delivery carries `session_ended` only while the session is still ended:
after a `--reopen` the old batch's end no longer closes the reopened session. Prompts queued while a batch is in flight ride the next batch. `review end --approved-by <who>` needs no server
(headless/CI): it records a closing round ended by the approver and sets `approved`.
Plan snapshots are not written: the plan row's sha256 tracks the file, and `brain check`
flags a missing or changed plan.

## Constants

- Port **4517** (`--port`, `BRAIN_AXI_PORT`). Bind `127.0.0.1` only.
- State dir `~/.brain-axi/` (`BRAIN_AXI_STATE_DIR`): `sessions.json`, `server.log`. Until
  `sessions.json` exists, a pre-0.3 `state.json` (same session shape) is read, so queued
  prompts and the user-end latch survive the upgrade. Servers on different ports share
  the store, so every read-modify-write holds `sessions.json.lock` (atomic `mkdir`; a lock
  older than 2 s is broken).
- Session key: first 16 hex of `sha256(realpath(file))` — `sessionKey()` in server.js,
  imported by the CLI.
- Idle shutdown: 30 min with no SSE client and no in-flight poll
  (`BRAIN_AXI_IDLE_TIMEOUT_MS`, `0`/`off` disables); 5 s once every session is ended and
  nothing is connected. Sessions live on disk, so `review poll` on a known session restarts
  the server (`ensureServer`) to hand over a final batch or the user's End.
- Brain binding: a session records the brain that opened it; the poll response carries it
  (`brain`), and `review poll` resolving a different brain refuses with `BRAIN_MISMATCH`
  before draining (and re-checks before recording), so no batch is recorded or acked into
  another repo's brain.
- Brain change poll: 1 s (`BRAIN_AXI_DB_POLL_MS`).
- `/health` → `{ok, app: "brain-axi", version, api}`. The CLI respawns a server whose
  `version` or `api` (`REVIEW_API`, currently 3) differs from its own.

## Session (sessions.json)

```json
{ "key": "0a1b2c3d4e5f6a7b", "file": "/abs/real/plan.html", "brain": "/abs/.brain",
  "root": "/abs/checkout", "plan": "auth", "feature": "auth",
  "url": "http://127.0.0.1:4517/session/0a1b2c3d4e5f6a7b", "status": "open|feedback|ended",
  "ended_by": null, "prompts": [], "inflight": null, "dom_snapshot": "", "chat": [{ "role": "user", "text": "", "at": "" }],
  "layout_warnings": [], "delivered_layout_keys": [], "updated_at": "" }
```

User-ended sessions latch: reopening needs `reopen: true` (`--reopen`). Reviving keeps
queued prompts and chat. A batch sent with the end still rides out on the next poll with
`session_ended: true`; the poll after that reports `status: "ended"`.

## Prompt shape — the only shape agents see

`{prompt, tag, selector, text, target, html}` plus a server-resolved `line` at poll time.
Normalized at the trust boundary: unknown tag → `message`; caps prompt 4000, text 400,
selector 300, html 300; client fields (`queueKey`, `uid`, a client `line`) dropped. Tags
and targets: `element` `{type}`, `text` `{type, commonAncestorSelector, start, end}`,
`message`, `screenshot` `{type, shot, x, y, note}`, `reference-image`
`{type, selector, alt, x, y, note}`, `decision` `{type, question, choice}`, `diagram-node`
`{type, diagramId, nodeId, label}`, `list-edit` `{type, section, action, item, index}`.
`line` is the 1-based line of the prompt's anchor text in the current artifact, or null
when absent, shorter than 10 chars, or ambiguous.

## HTTP API

POSTs are same-origin guarded: an `Origin`/`Referer` that is present must match the host
(CLI calls carry none). Body limit 2 MB.

| Route | Purpose |
|---|---|
| `GET /health`, `POST /shutdown` | liveness / exit (broadcasts `chrome-reload` first; same-origin guarded) |
| `POST /api/open` `{file, plan?, feature?, reopen?, brain?, root?}` | validate against brain.db (feature must exist), open/revive the session → `{key, url, status, plan, feature}` or `{refused, reason, key, url}` |
| `GET /api/poll?key=&reply=` | long-poll; `reply` posts an agent chat line first. 15 s whitespace heartbeat |
| `POST /api/feedback` `{key, prompts, end?, dom_snapshot?}` | browser queues prompts (409 on an ended session) → `{ok, queued}` |
| `POST /api/ack` `{key, batch}` | the CLI recorded the polled batch → delete it (`{ok, acked}`; unknown id is a no-op) |
| `POST /api/end` `{key, by}` | end the session (idempotent) |
| `POST /api/layout` `{key, warnings}` | layout audit from the chrome; a fresh error wakes the poll |
| `GET /events/<key>` | SSE: `chat-sync`, `agent-presence`, `agent-reply`, `reload`, `context-update`, `chrome-reload` |
| `GET /session/<key>` | chrome page |
| `GET /session/<key>/artifact` | the plan with one injected `<script src="/session/<key>/sdk.js" data-brain-ui>` and a strict CSP (self + inline only) |
| `GET /session/<key>/context` | `planContext` + `{session}` + `execution` (when a feature is bound) |
| `GET /session/<key>/health` | `{checks}` — `lib/brain` check rows |
| `GET /session/<key>/asset/<rel>`, `GET /session/<key>/<rel>` | files next to the artifact (sandboxed); the second form is what the artifact's own relative `src`/`href` resolve to (matched last, after every named session route) |
| `GET /session/<key>/shot/<rel>`, `GET /watch/<f>/shot/<rel>?brain=` | a shot **recorded in brain.db**, served from the main checkout (`mainRoot` — shots live in its `.brain/shots/`, shared by every worktree; sandboxed) |
| `GET /watch/<f>?brain=<abs .brain>[&root=<abs worktree>]` | dashboard page; 404 `{error, code, help}` on a bad brain or unknown feature. `root` (set by `brain watch` from a worktree, carried into every dashboard fetch) checks plan files in that checkout; ignored unless it is a checkout of the brain's repo |
| `GET /watch/<f>/context?brain=` | `watchContext` |
| `GET /watch-events/<f>?brain=` | SSE `context-update` |
| `POST /watch/<f>/annotate[/delete|/send]?brain=` | pin add `{shot, x, y, note}` / delete `{id}` / mark sent |
| `GET /chrome.js`, `/dashboard.js`, `/lightbox.js`, `/vendor/mermaid.min.js`, `/session/<key>/sdk.js` | static |

Poll payloads (wire contract unchanged; `batch` and `redelivered` are additive):

- `{status: "feedback", prompts: [...], batch, redelivered?, dom_snapshot | dom_snapshot_chars: 0, layout_warnings?, session_ended?, ended_by?, next_step}`
- `{status: "ended", ended_by, next_step}` · `{status: "missing", next_step}`

`next_step` strings live in `NEXT_STEP` (server.js). Presence: a poll attached →
`listening`; prompts queued with no poll → `working`; else `waiting`.

## Change detection

- Artifact: `fs.watch` on its directory filtered by basename (survives atomic renames),
  150 ms debounce → `reload`.
- Brain: each SSE key that renders brain data is bound to its brain dir; a ticker compares
  `PRAGMA data_version` of the server's handle (bumped by any other connection's commit —
  the CLI's writes) and sends `context-update`. The baseline is taken at bind time, and
  every new stream gets one `context-update` so a page that fetched before connecting
  catches up. The same tick also compares a size+mtime signature of the brain's recorded
  files — shots in the main checkout, plan files and plan snapshots in each checkout a
  bound page checks them in (distinct paths, re-read only when `data_version` moves; one
  stat per file per tick) — so a file replaced, edited or deleted with no brain.db write
  (pins turn superseded, file health changes) still sends `context-update`. Reopening a
  session (`/api/open`) rebinds an already-open tab to the brain it was reopened with and
  sends it `context-update`. A brain no page is bound to and
  untouched for 5 minutes has its handle closed (reopened on the next request). Pin writes broadcast directly (they are not in brain.db) — to the feature's
  dashboard and to every review tab on the same brain — and the tick also signs the
  brain's pins in `sessions.json` (re-read only when its size/mtime moves), so a pin
  written through a server on another port still refreshes this server's pages.

## Payloads (context.js)

- `planContext` → `{plan: {slug, title, status, rounds, created, updated, feature}, plans[≤10],
  reviews[≤5 newest: {at, round, prompts, ended_by}], screenshots, verifications,
  features: {total, counts, in_progress[]}, last_checkpoint: {date, summary}}`
- `executionContext` → `{feature: {slug, status, evidence}, checkpoints[≤5: {date, summary}],
  runs[{name, title}], verifications[{date: "YYYY-MM-DD rN", verdict, round, commit, dirty}],
  shots[{rel, caption}], annotations[{id, shot, x, y, note, at, superseded, sentAt}]}`; an
  unknown feature degrades to `status: "unknown"`.
- `watchContext` = execution + `run_steps[{name, title, file, steps[{n, title, observed,
  truncated, task, author, at}]}]` (observed capped at 8000 chars; `file` is the
  `brain runs view` command) + `pr: {url, opened_at} | null` + `checks[{check, status, detail}]`.
- A pin is `superseded` once its shot file is gone or its sha256 changed since the pin.
- The CLI reads pins (never writes them) through `readPins(brainDir, feature?)` from
  `server.js` — read-only, never creates the state dir, corrupt store = no pins.
  `brain verifications view <f>` lists the feature's SENT pins (`pins` table: shot, pin
  position, note, created, sent, state `open|superseded|re-verified` — re-verified = a
  verification round was recorded after it was sent) and only counts unsent ones
  (`draft_pins`: still being drafted); `brain context` adds a `pins:` line counting sent
  open pins.

## postMessage (chrome ⇄ sdk)

`{type: "brain:<name>"}`; the chrome checks `event.source === frame.contentWindow`, the SDK
checks `window.parent`. Chrome → SDK: `setAnnotationMode`, `requestSnapshot`,
`restoreScroll`. SDK → chrome: `ready`, `queuePrompt {prompt}`, `toggleAnnotationMode`,
`scroll`, `snapshot`. `window.brain.queuePrompt({tag, prompt, target, queueKey})` is the
public API plan artifacts call (decision cards, list edits); a repeated `queueKey`
replaces the queued item. Opened standalone, the SDK is a safe no-op.

## Security invariants

1. Loopback bind only; a request whose `Host` is not `127.0.0.1`/`localhost`/`[::1]` gets 421 before any route (DNS rebinding); same-origin guard on every browser-facing POST, `/shutdown` included.
2. Artifact iframe sandboxed without `allow-same-origin`; CSP allows no remote origin.
3. Artifact-file routes are realpath-contained; shot routes serve only paths recorded in brain.db.
4. Every browser-supplied object is normalized at the boundary.
5. The injected SDK tag is the only artifact mutation.
6. CLI stdout is TOON only; the server logs to stderr (`server.log`).

## Tests

`test/review/context.test.js` (payload builders on a temp brain.db) and
`test/review/server.test.js` (a real server on a free port driven by the CLI: open →
feedback → poll records the round → agent reply → `end --approved-by`; user end + latch;
watch context, recorded-shot serving, pins, `context-update` after a CLI write).
