[brain-ux reference — section 4: user-journey flow]

-------------------------------------------------------------------------------
4. USER-JOURNEY FLOW
-------------------------------------------------------------------------------
What it's for: a mermaid flowchart of how a person actually moves between the
screens in section 2 — the trigger on every edge, not just where they land —
including the branches where they hit an error or give up, not only the happy
path. Reuse `plan`'s mermaid conventions exactly: `flowchart TD` (top-down, so
nodes stay large and click-annotatable, not compressed into an LR pipeline),
wrapped in `<pre class="mermaid">` to degrade offline, sharing the one CDN
`<script type="module">` import the plan's big-picture diagram already added.

    <pre class="mermaid">
    flowchart TD
      A[Reviewer opens Settings] --> B{Any channels configured?}
      B -->|no| C[Empty state: 'Add your first channel']
      B -->|yes| D[Default state: channel list]
      C -->|clicks Add channel| E[Add channel modal]
      D -->|clicks Add channel| E
      D -->|clicks Manage| F[Edit existing channel]
      E -->|Save| G{Save succeeds?}
      G -->|yes| D
      G -->|no| H[Inline field error]
      H -->|retries| E
      H -->|gives up| I[Closes modal — abandons]
      E -->|Cancel| I
    </pre>

Do not confuse this with `plan` §12's golden-path sequence diagram — different
questions, different diagram types, on purpose. The golden path is what the
SYSTEM does (Browser -->> Worker -->> KV); this flow is what the USER does
(clicks, decisions, dead ends). A plan that adds a screen needs both: the
sequence diagram proves the request works, this one proves the human can get
through it, including when something goes wrong.

