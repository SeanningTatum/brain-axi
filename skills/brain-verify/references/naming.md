[brain-verify reference — step 2: naming screenshots and the verdict]

-------------------------------------------------------------------------------
2. NAMING CONVENTION — screenshot files
-------------------------------------------------------------------------------

Screenshot FILES live under `.brain/shots/<slug>/` (`<brainDir>/shots/<slug>/`
with a custom `--brain` dir; gitignored by `brain init`).
brain stores each as path + sha256 on the verdict; `brain check` re-hashes
them, so do not edit or overwrite a file a recorded verdict cites.

- Golden path steps: NN-<step>, zero-padded two digits, in order:
  01-signin.png, 02-dashboard.png, 03-....png
- Error path steps: E<N>-<step>, one per error scenario walked:
  E1-bad-login.png, E2-....png
- Acceptance-criterion evidence: A<N>-<step>, N = the criterion's row number
  in the Acceptance criteria table: A3-reorder-frames.png. Reuse a golden-
  path shot instead when it already shows the criterion — cite it in the row.
- Edge probes: X<N>-<step>: X1-empty-state.png.
- Fix round N >= 2: every file name above gains an rN- prefix
  (r2-01-signin.png, r2-E1-bad-login.png, r2-A3-reorder-frames.png) so a
  re-walk never overwrites the files round 1's recorded verdict cites.
- Use the same step string in the verdict body's table and in the `--shot`
  caption (`--shot .brain/shots/<slug>/01-signin.png::"01-signin: sign in"`).

The verdict itself has no file name: it is a row in brain.db, identified by
feature slug and an automatic round number (1, 2, ...). The body you write is
a scratch file (e.g. under tmp/, gitignored) passed with `--body-from`; it is
stored in brain.db, not committed.
