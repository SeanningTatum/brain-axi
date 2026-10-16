[brain-plan reference — section 0: shared foundations (style block, palette)]

-------------------------------------------------------------------------------
0. SHARED FOUNDATIONS — write this once, in <head>, use it everywhere below
-------------------------------------------------------------------------------

One file, inline CSS, no build step. Define a small set of reusable classes up
front so every section below is just HTML using them. This is a complete,
copy-pasteable starting <style> block:

    <style>
      :root {
        --bg: #faf9f5; --surface: #ffffff; --fg: #141413; --fg-secondary: #3d3d3a;
        --muted: #73726c; --border: #dedcd1; --highlight: #fff7ca; --accent: #d97757;
        --space-2: 8px; --space-3: 16px; --space-4: 24px; --space-6: 40px;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
          Helvetica, Arial, sans-serif;
        font-size: 16px; background: var(--bg); color: var(--fg); line-height: 1.6;
        max-width: 72ch; margin: 0 auto; padding: var(--space-6) var(--space-4);
      }
      h1, h2, h3 {
        font-family: Charter, "Iowan Old Style", "Palatino Linotype", Georgia, serif;
        font-weight: 600; line-height: 1.25; color: var(--fg);
      }
      h1 { font-size: 1.75em; }
      h2 { font-size: 1.3em; font-weight: 500; margin-top: var(--space-6);
        border-bottom: 1px solid var(--border); padding-bottom: var(--space-2); }
      h3 { font-size: 1.05em; font-weight: 500; }
      p, li { color: var(--fg-secondary); }
      mark, .highlight { background: var(--highlight); color: var(--fg); padding: 0 2px; }
      .chip { display: inline-block; padding: 2px 10px; border-radius: 999px;
        font-size: 0.8em; font-weight: 600; border: 1px solid var(--border); }
      .chip-status-draft { background: var(--surface); color: var(--muted); }
      .chip-status-in-review { background: var(--highlight); color: var(--fg);
        border-color: var(--highlight); }
      .chip-status-reviewed { background: var(--fg); color: #fff; border-color: var(--fg); }
      .chip-high { color: var(--accent); border-color: var(--accent); }
      .chip-med { color: var(--fg-secondary); }
      .chip-low { color: var(--muted); }
      .decision-card { background: var(--surface); border: 1px solid var(--border);
        border-radius: 10px; padding: var(--space-4); margin: var(--space-4) 0; }
      table { width: 100%; border-collapse: collapse; margin: var(--space-3) 0;
        background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
        overflow: hidden; }
      th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid
        var(--border); vertical-align: top; }
      tr:last-child td { border-bottom: none; }
      .tag-recommended { color: var(--accent); font-weight: 600; }
      .btn-queue, .btn-approve, .btn-request-changes {
        border: none; border-radius: 10px; padding: 8px 16px; font-weight: 600;
        cursor: pointer; font-size: 0.95em;
      }
      .btn-queue, .btn-approve { background: var(--fg); color: #fff; }
      .btn-request-changes { background: transparent; color: var(--fg);
        border: 1px solid var(--border); }
      .queue-ack { margin-left: var(--space-3); font-size: 0.9em; color: var(--muted); }
      .checklist { list-style: none; padding: 0; }
      .checklist li { margin: var(--space-2) 0; }
      pre.mermaid { text-align: center; }
      pre.mermaid svg { display: block; margin: 0 auto; }
      .arch-diagram .box { fill: var(--surface); stroke: var(--fg-secondary); stroke-width: 2; }
      .arch-diagram .box-label { fill: var(--fg); font-size: 14px; }
      .arch-diagram .arrow { stroke: var(--muted); stroke-width: 2;
        marker-end: url(#arrow); }
    </style>

Every section below assumes this block (or your own equivalent) is already in
<head>. Do not link an external stylesheet — inline it.

Palette discipline (read once, applies everywhere below): warm vellum
background (--bg), ink text (--fg) with a softer --fg-secondary for body copy
and --muted for de-emphasized text, hairline --border everywhere a rule or
card edge is needed, --highlight (a pale yellow) reserved for emphasized or
highlighted phrases, and exactly ONE accent (--accent, terra cotta) reserved
for "(recommended)" markers and small emphasis — never a second brand color,
never a saturated red/green/amber, never a gradient. This is a fixed,
committed light palette (no @media (prefers-color-scheme: dark) override) —
a plan is a piece of editorial writing, not a themed app surface, and it
should look the same read next to the review sidebar every time.

