[brain-verify reference — section 1: CLI-only features]

- CLI-ONLY FEATURES. When nothing the feature changed is reachable from a
  browser (a CLI command, a library API, a script, a background job), there
  is no app to start and no browser to drive. All three layers below still
  apply, walked by running the real commands yourself: the golden path is
  the primary invocation end to end, the error path is a bad-input /
  refused / non-zero-exit case, edge probes are the empty / repeated /
  out-of-order invocations. Evidence per step is the exact command, its exit
  code, and the observed stdout/stderr (quoted, or a saved transcript linked
  in place of a screenshot). The header's Base URL reads
  `n/a — CLI-only`. This is not a lower bar: an unrun command is an
  unwalked criterion, exactly like an unvisited page.
