[brain-verify reference — section 4: console policy]

-------------------------------------------------------------------------------
4. CONSOLE POLICY — jsErrors vs networkErrors
-------------------------------------------------------------------------------

Split every console/page finding into exactly two buckets:

- **jsErrors** — uncaught exceptions, React/hydration warnings, anything
  logged at console.error from app code. Rule: ANY entry here is a FAIL,
  full stop, unless you can trace it to something OUTSIDE the app (see the
  "environment artifact" carve-out below).
- **networkErrors** — non-2xx responses, formatted "<status>@<step>". Rule:
  expected on error-path steps (a 401 from a rejected login is the CORRECT
  behavior, not a defect) — only counts against the verdict if it fired on a
  GOLDEN-PATH step, where it means something broke that shouldn't have.

Environment-artifact carve-out: if a jsError looks app-related but you can
grep the app's own source and confirm the offending token/style/attribute
appears NOWHERE in it, it's very likely a browser extension or the test
harness itself, not a real defect — investigate, state your evidence (what
you grepped, what you found or didn't), and note it as "environment artifact,
not a FAIL" in the Console section rather than silently excluding it. Do not
use this carve-out as an excuse to wave away something you didn't actually
check.

