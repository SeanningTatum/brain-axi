[brain-verify reference — section 2: screenshot naming convention]

-------------------------------------------------------------------------------
2. NAMING CONVENTION — screenshots
-------------------------------------------------------------------------------

- Golden path steps: NN-<step>, zero-padded two digits, in order:
  01-signin.png, 02-dashboard.png, 03-....png
- Error path steps: E<N>-<step>, one per error scenario walked:
  E1-bad-login.png, E2-....png
- Acceptance-criterion evidence: A<N>-<step>, N = the criterion's row number
  in the Acceptance criteria table: A3-reorder-frames.png. Reuse a golden-
  path shot instead when it already shows the criterion — cite it in the row.
- Edge probes: X<N>-<step>: X1-empty-state.png.
- Fix round N >= 2: every name above gains an rN- prefix (r2-01-signin,
  r2-E1-bad-login, r2-A3-reorder-frames) — see section 6.
- The step name is the SAME string you pass to --step below (the CLI derives
  the filename from it, extension included automatically) — keep it short
  and descriptive; it is what appears in the verdict doc's table too.

