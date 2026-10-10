[brain-ux reference — section 1: the wireframe CSS kit]

-------------------------------------------------------------------------------
1. THE WIREFRAME CSS KIT
-------------------------------------------------------------------------------
What it's for: a small set of `.wf-*` classes that let you sketch a screen as
plain greyscale boxes and lines — enough to judge layout, hierarchy, and flow,
not enough to judge color or type. Append this to the plan playbook's §0
`<style>` block; it reuses that block's custom properties (`--surface`,
`--border`, `--fg`, `--muted`, `--space-*`) instead of any new hardcoded color,
which is the whole point (see below).

    /* ---- WIREFRAME KIT — append to plan §0's <style> block ---- */
    .wf-screens { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: var(--space-3); margin: var(--space-3) 0; }
    .wf { background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
      overflow: hidden; font-size: 0.85em; }
    .wf-bar { display: flex; align-items: center; gap: 6px; padding: 6px 10px;
      border-bottom: 1px solid var(--border); color: var(--muted); }
    .wf-dot { width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--border); }
    .wf-body { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .wf-row { display: flex; gap: 8px; align-items: center; }
    .wf-col { display: flex; flex-direction: column; gap: 8px; flex: 1; }
    .wf-block { background: color-mix(in srgb, var(--fg) 8%, var(--surface));
      border-radius: 6px; height: 44px; }
    .wf-block.tall { height: 88px; }
    .wf-line { background: color-mix(in srgb, var(--fg) 16%, var(--surface));
      border-radius: 3px; height: 8px; }
    .wf-line.short { width: 40%; }
    .wf-line.med { width: 65%; }
    .wf-btn { display: inline-block; border: 1px solid var(--fg-secondary); border-radius: 6px;
      padding: 3px 12px; font-size: 0.9em; color: var(--fg); }
    .wf-btn.primary { background: var(--fg); color: #fff; border-color: var(--fg); }
    .wf-input { border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px;
      color: var(--muted); flex: 1; }
    .wf-label { font-size: 0.8em; color: var(--muted); text-transform: uppercase;
      letter-spacing: 0.04em; }
    .wf-caption { font-size: 0.85em; color: var(--muted); padding: 6px 12px 10px; }
    .wf-note { border-left: 2px solid var(--accent); padding-left: 10px; font-size: 0.9em;
      color: var(--muted); }

`.wf-block` and `.wf-line` deliberately use `color-mix(in srgb, var(--fg) N%,
var(--surface))` rather than a new grey hex literal — an earlier draft of this
kit used raw `#f1efe7` / `#e8e6dc` fills, which is exactly the drift this
playbook exists to prevent: change `--fg` or `--surface` and those hardcoded
greys silently stop matching, while `color-mix()` tracks the palette
automatically. No `color-mix()` support in your target? Fall back to
`var(--border)` for both rather than inventing a new color.

The constraint is deliberate, not a limitation you work around: greyscale
wireframes get critiqued for layout and flow — is the button in the right
place, does the empty state make sense — because there is nothing else to
react to. Add real color and type and a reviewer critiques color and type
instead; the planning round quietly becomes a design-polish round before
anyone agreed the layout is right. Decision 2 of the approved plan
(`.brain/features/planning-ux/planning-ux.md`) chose greyscale-by-default for
this reason, with one escape hatch: an `<img>` reference — an existing
screenshot, a design comp that already exists, or a mockup too visually dense
to fake in boxes-and-lines (a chart, a photo, a brand lockup) — gets pin-drop
annotation instead (section 6). Reach for it only when the thing genuinely
can't be sketched, not because sketching is more work than pasting an image.

