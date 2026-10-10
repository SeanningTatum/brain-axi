[brain-plan reference — sections 10-15]

-------------------------------------------------------------------------------
10. PLAN OF RECORD — phased steps with acceptance criteria
-------------------------------------------------------------------------------
What it's for: what you're actually going to do, in order, and how you'll know
each phase is done. Not a task list — acceptance criteria, so "done" is
checkable.

- **Acceptance is a testable behavior**, observable by a verifier driving the
  product or running a named command — "a reload keeps the session", not
  "sessions are robust". A criterion nobody could fail is not one.
- **Each phase states how it will be verified** (a "Verify:" clause). These
  become the `--verify` lines the execute playbook's contract step agrees
  with an independent verifier before any code.
- **Stay at product + high-level design.** Constrain the deliverable, not the
  path: no exact function signatures or line-level edits the implementer
  should discover. Wrong detail pinned upfront cascades into every phase
  built on it; the same goes for section 11 — paths and why, not diffs.

    <section id="plan-of-record">
      <h2>Plan of record</h2>
      <ol>
        <li><strong>Phase 1 — introduce a KV-backed SessionStore.</strong>
          Acceptance: SessionStore implemented for KV; unit tests pass against
          a local KV simulator.
          Verify: run the session-store suite against the simulator.</li>
        <li><strong>Phase 2 — cut over reads, dual-write.</strong>
          Acceptance: reads prefer KV with a fallback to memory; writes go to
          both; zero session-loss errors in staging for 24h.
          Verify: sign in on staging, restart the app, reload — still signed
          in; read the 24h session-error count.</li>
        <li><strong>Phase 3 — remove the in-memory path.</strong>
          Acceptance: in-memory store deleted; all tests green; one week in
          prod with no regression in session-related error rate.
          Verify: grep finds no memory-store import; full suite green.
          <details>
            <summary>Why not do this in one phase?</summary>
            <p>Dual-write gives us a rollback path if KV read latency turns
            out to be a problem under load — cutting straight over would mean
            debugging in prod with no fallback.</p>
          </details>
        </li>
      </ol>
    </section>

-------------------------------------------------------------------------------
11. FILES THAT CHANGE
-------------------------------------------------------------------------------
What it's for: a reviewer scanning the blast radius. One row per path: what
kind of change, and why — not a full diff.

    <section id="files-changed">
      <h2>Files that change</h2>
      <table>
        <thead><tr><th>Path</th><th>Change</th><th>Why</th></tr></thead>
        <tbody>
          <tr><td>src/auth/session-store.ts</td><td>new</td>
            <td>KV-backed implementation</td></tr>
          <tr><td>src/auth/middleware.ts</td><td>edit</td>
            <td>read/write through the new store</td></tr>
          <tr><td>src/auth/memory-store.ts</td><td>delete (phase 3)</td>
            <td>superseded</td></tr>
        </tbody>
      </table>
    </section>

-------------------------------------------------------------------------------
12. GOLDEN PATH — the happy-path walkthrough end to end
-------------------------------------------------------------------------------
What it's for: how a normal request actually flows through the new design,
step by step. A sequence diagram is the natural fit here — see MERMAID
GUIDANCE below for the snippet and the "sequenceDiagram" recommendation.

-------------------------------------------------------------------------------
13. ERROR PATHS
-------------------------------------------------------------------------------
What it's for: the failure modes a reviewer will ask about anyway — surface
them yourself. One row per failure: how it's detected, how it's handled, and
what the user actually sees.

    <section id="error-paths">
      <h2>Error paths</h2>
      <table>
        <thead><tr><th>Failure</th><th>Detected by</th><th>Handled by</th>
          <th>User sees</th></tr></thead>
        <tbody>
          <tr><td>KV lookup miss (expired/evicted)</td>
            <td>null return from the KV get</td>
            <td>middleware treats it as unauthenticated</td>
            <td>redirected to /login</td></tr>
          <tr><td>KV write failure</td>
            <td>thrown exception</td>
            <td>retried once, then dual-writes to memory for this request</td>
            <td>no visible error; session still works for this request</td></tr>
        </tbody>
      </table>
    </section>

-------------------------------------------------------------------------------
14. TESTING PLAN — checklist
-------------------------------------------------------------------------------
What it's for: coverage the reviewer can skim and trust — golden path, every
error path above, and the regression surface. Native checkboxes are fine here
(markdown can't do this at all, which is exactly why this is an HTML artifact).

    <section id="testing-plan">
      <h2>Testing plan</h2>
      <ul class="checklist">
        <li><label><input type="checkbox"> Golden path: upload a 10MB file,
          confirm it appears in the dashboard within 5s</label></li>
        <li><label><input type="checkbox"> Error path: upload exceeds size
          limit -&gt; inline error, no partial row created</label></li>
        <li><label><input type="checkbox"> Error path: KV write failure ->
          request still succeeds via memory fallback</label></li>
        <li><label><input type="checkbox"> Regression: existing signed-URL
          download flow still works</label></li>
      </ul>
    </section>

-------------------------------------------------------------------------------
15. OPEN QUESTIONS
-------------------------------------------------------------------------------
What it's for: things you genuinely don't have a shortlist for yet — not
decision-card-ready. Plain list; these are discussion points, not click
targets.

    <section id="open-questions">
      <h2>Open questions</h2>
      <ul>
        <li>Do we need per-region KV replication for latency, or is eventual
          consistency fine for session reads?</li>
        <li>Should session TTL be configurable per user role?</li>
      </ul>
    </section>

