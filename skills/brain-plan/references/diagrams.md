[brain-plan reference — mermaid guidance and other components]

-------------------------------------------------------------------------------
MERMAID GUIDANCE
-------------------------------------------------------------------------------
Preferred approach — Mermaid via CDN, degrades to readable text offline:

    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral" });
    </script>

    <pre class="mermaid">
    flowchart TD
      Browser -->|cookie| Worker
      Worker -->|read/write session| KV[(Cloudflare KV)]
      Worker --> D1[(D1: users)]
    </pre>

Center rendered diagrams (include in the shared style block):

    pre.mermaid { text-align: center; }
    pre.mermaid svg { display: block; margin: 0 auto; }

LAYOUT RULE — prefer VERTICAL diagrams (flowchart TD, top-down). A document
scrolls vertically: a TD flowchart keeps every node at readable size and easy
to click-annotate, while an LR (left-right) chart compresses horizontally at
document width until nodes are tiny. Use LR only when the flow is genuinely
short (<= 4 nodes) and reads better as a pipeline. sequenceDiagram is already
vertical. In the brain review UI, reviewers can click individual diagram nodes
to annotate them and zoom any diagram into a pan/zoom lightbox — bigger nodes
make both easier.

Why this is safe offline: a <pre> block renders as plain monospace text before
any script runs. If the CDN import fails (no network), the reviewer still sees
readable flowchart source instead of a broken widget or blank space — the
diagram degrades to text, it never disappears.

Use flowchart for the big picture (section 5) and sequenceDiagram for the
golden path (section 12):

    <pre class="mermaid">
    sequenceDiagram
      participant B as Browser
      participant W as Worker
      participant KV as Cloudflare KV
      B->>W: GET /dashboard (cookie: sid)
      W->>KV: get(sid)
      KV-->>W: session JSON
      W-->>B: 200 rendered dashboard
    </pre>

Alternative — hand-rolled inline SVG, for guaranteed offline rendering with no
network dependency at all (use this if the reviewer's environment might be
fully air-gapped, or you want zero risk of a CDN hiccup):

    <svg class="arch-diagram" viewBox="0 0 640 120" role="img"
      aria-label="Client to API to Database">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5"
          markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="currentColor"></path>
        </marker>
      </defs>
      <rect x="10" y="30" width="140" height="60" rx="8" class="box"></rect>
      <text x="80" y="65" text-anchor="middle" class="box-label">Client</text>
      <line x1="150" y1="60" x2="245" y2="60" class="arrow"></line>
      <rect x="250" y="30" width="140" height="60" rx="8" class="box"></rect>
      <text x="320" y="65" text-anchor="middle" class="box-label">API</text>
      <line x1="390" y1="60" x2="485" y2="60" class="arrow"></line>
      <rect x="490" y="30" width="140" height="60" rx="8" class="box"></rect>
      <text x="560" y="65" text-anchor="middle" class="box-label">Database</text>
    </svg>

-------------------------------------------------------------------------------
OTHER MARKDOWN-IMPOSSIBLE COMPONENTS WORTH USING
-------------------------------------------------------------------------------

- Checklist with native checkboxes — shown above in the testing plan. Also
  useful anywhere you want "is this actually done" to be a clickable state
  instead of prose.

- <details>/<summary> for depth layering — shown above in the plan of record.
  Use it for "why not X" asides, background a skimming reviewer can skip, or
  a deep-dive that would otherwise bloat the main flow. Keeps the default view
  short while the detail is one click away.

- Severity / status chips — the chip-* classes from section 0:

    <span class="chip chip-high">high risk</span>
    <span class="chip chip-status-draft">draft</span>

  Drop these next to any table row or heading where a reviewer benefits from
  a fast visual read (risk level, doneness, blocking/non-blocking).

- Approve / request-changes button pair — a simple verdict, queued the same
  way as a decision card, with its own fixed queueKey so repeated clicks
  replace rather than stack:

    <div>
      <button type="button" class="btn-approve" data-brain-action
        onclick="queueVerdict('approve')">Approve plan</button>
      <button type="button" class="btn-request-changes" data-brain-action
        onclick="queueVerdict('request-changes')">Request changes</button>
    </div>

    <script>
      function queueVerdict(verdict) {
        if (!(window.brain && typeof window.brain.queuePrompt === "function")) return;
        window.brain.queuePrompt({
          tag: "message",
          queueKey: "verdict",
          prompt: verdict === "approve"
            ? "Plan approved as written."
            : "Requesting changes — see annotations."
        });
      }
    </script>

