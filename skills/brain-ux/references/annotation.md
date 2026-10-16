[brain-ux reference — section 6: how a reviewer annotates a mockup]

-------------------------------------------------------------------------------
6. HOW A REVIEWER ANNOTATES A MOCKUP
-------------------------------------------------------------------------------
What it's for: the exact click-to-annotation behavior from `lib/review/sdk.js`
— get this wrong and reviewer clicks either do nothing or do the wrong thing.

- **Explore mode (default, annotate off).** Ordinary elements do nothing on
  click. Two exceptions: a rendered mermaid diagram opens a pan/zoom lightbox
  on plain click, and a reference `<img>` (below) shows a hover "⤢" button
  that opens the pin-drop lightbox.
- **Annotate mode (toggled on).** A click on any element NOT matching the
  SDK's `NATIVE_SKIP_SELECTOR` (`button, input, select, textarea, option,
  label, summary, a[href], [contenteditable]`) and not inside
  `[data-brain-action]`/`[data-brain-ui]` is captured (`shouldSkip` in
  `sdk.js`) as an ELEMENT annotation: a CSS-path selector, a capped text
  excerpt, and a capped `outerHTML` locator hint, tag `"element"`. This is
  exactly what you want for ordinary wireframe scenery — a `.wf-block` or
  `.wf-line` the reviewer thinks is misplaced SHOULD be swallowed this way,
  because that swallow IS the annotation. Never put `data-brain-action` on
  plain wireframe pieces; it would make them un-annotatable.
- **Where `data-brain-action` matters.** Only on CUSTOM elements not already
  in `NATIVE_SKIP_SELECTOR` that carry their own click behavior you don't want
  intercepted — a decision-card's outer `div`, a "Queue answer" button, or any
  `.wf-btn`/`.wf-input` you script a real handler onto. Radios, checkboxes,
  and labels are native and already skipped regardless of the attribute; the
  kit's plain `.wf-btn`/`.wf-input` spans used as pure scenery (no handler)
  are fine left bare — they're meant to be annotated, not clicked.
- **SVG diagram-node annotation.** A click inside a rendered diagram (section
  4's flow, or `plan` §5's big picture) does NOT annotate a random generated
  SVG path — it walks up from the click target to the nearest `<g id="...">`
  that is either a mermaid node (class `node`) or carries a non-empty text
  label, and queues tag `"diagram-node"` with `queueKey =
  "<diagramId>:<nodeId>"` (re-annotating the same node replaces, not stacks).
  No matching node found → falls back to annotating the whole `<svg>` as a
  generic element. Practical effect: a reviewer can click the `E -->|Save| G`
  node in section 4's flowchart and say "this should also handle a timeout,"
  anchored to that exact node — not to "the diagram" as one blob.
- **Reference-image pin-drop (the escape hatch from section 1).** Applies
  only to real `<img>` elements, never the wireframe kit (it has no images).
  An `<img>` qualifies when both rendered dimensions are >= 80px, it isn't
  inside an `a[href]` (a linked image is navigation, not a reference), and
  isn't `data-brain-no-zoom` (`data-brain-zoom` force-opts in regardless of
  size). Hovering shows the same "⤢" affordance as a diagram. Which click
  opens the lightbox depends on WHERE and WHICH MODE, and the difference
  matters: the hover "⤢" button opens it in EITHER mode (it is
  `data-brain-ui`, so the annotation handler skips it), while a plain click
  on the image ITSELF opens it only in explore mode — in annotate mode that
  same click falls through to the generic element handler and queues an
  ordinary `"element"` annotation on the `<img>` instead, because `<img>`
  is not in `NATIVE_SKIP_SELECTOR`. Tell reviewers to use the "⤢" button.
  Opening it posts the image up to the review chrome (the artifact iframe
  can't open the lightbox itself), which opens the shared
  `BrainLightbox`. The reviewer drops a numbered pin at an x%/y% coordinate
  with a note; it queues tag `"reference-image"`, `target: {selector, alt, x,
  y, note}`, `queueKey = "refimg:<selector>:<x>:<y>"` (re-pinning the same
  spot replaces). Use this only for a real image attachment — never as a
  workaround for a wireframe you didn't want to build in HTML.

