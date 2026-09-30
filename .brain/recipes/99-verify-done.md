# Recipe: Verify done (termination check)

Run before declaring a task complete. `brain-axi` has **no test framework, no build, no lint** — verification = invoke the affected command and eyeball behavior.

## Why this exists

Agents stop at "the code looks right." This list forces an actual run + brain-coherence check before handoff.

## 1. Run the affected command(s)

```bash
node bin/brain.js <cmd> --brain .brain
echo $?          # 0 success/no-op, 1 opError, 2 usageError — must match intent
```

For every command you touched: run it against the local `.brain`, confirm the **exit code**, eyeball the **TOON on stdout**, and confirm **stderr is diagnostics-only** (no payload leaked to stderr, no free text on stdout). Every result must end with a `help:` list.

Write commands mutate `.brain/`, and **`.brain/` is this repo's live harness, not a fixture**. Revert only the throwaway writes you made to exercise a command, and do it file by file:

```bash
git diff --stat .brain/                 # see exactly what your test writes touched
git checkout -- .brain/<that-file>      # revert ONLY the throwaway test write
```

Never run a blanket `git checkout .brain/`. It discards real checkpoints, run notes, and verdicts along with the test noise. A cleaner option is to test write commands against a scratch brain (`brain init` in a temp dir, then `--brain <tmp>/.brain`).

## 2. Skill drift gate

```bash
node bin/brain.js skill --check
echo $?          # MUST be 0 — 1 means skillContent() drifted from the real commands
```

If you added/renamed a command or changed guidance, update `skillContent()` until this is green.

## 3. Browser walk (ONLY for `brain review` changes)

If you touched `lib/review/*`: start the server, open a session, exercise the real flow.

```bash
node lib/review/server.js            # or: node bin/brain.js review <some.html> --brain .brain
```

Walk: annotate mode (Cmd/Ctrl+I) → composer send → SSE reload on artifact edit → presence pill → `brain review poll` receives normalized prompts. **Do not claim the review UI works without opening the browser.** Skip only for pure server/store/brain-data changes with no browser surface — note the skip in your run note.

## 4. Brain coherence

`git diff --stat` → for every changed path, update the owning brain doc:

| Touched | Brain doc to update |
|---------|---------------------|
| `bin/brain.js` command surface | `codebase/programming-model.md`, `rules/cli-commands.md`, and `skillContent()` |
| TOON / output behavior | `rules/toon-axi.md` |
| `lib/review/server.js`,`store.js`,`brain-data.js` | `rules/review-server.md` + `docs/REVIEW-ARCHITECTURE.md` |
| `lib/review/chrome.*`,`sdk.js` | `rules/review-browser.md` + `docs/REVIEW-ARCHITECTURE.md` |
| Feature behavior change | `features/<slug>/<slug>.md` (Changelog table) |
| Architectural / harness shift | `CHANGELOG.md` + bump `feature_list.json` `updated` |

## 5. Non-negotiables sweep

```bash
git diff | grep -E '^\+' | grep -E 'console\.log|require\(|from "[^.]' # stdout free text / CommonJS / npm import smells
```

Any hit → re-read `codebase/programming-model.md` and fix. (Legit stdout goes through `print()`; imports are Node stdlib or relative.)

## 6. Declared checks + brain check

```bash
node bin/brain.js verify --brain .brain  # every verify.json check; results table prints even on failure
node bin/brain.js check --brain .brain   # exit 1 if any harness invariant fails
```

## 7. Independent verification (any feature ship or user-visible change)

The implementer does not write the verdict. Hand the verification to a **fresh-context verifier**, an agent that did not implement the change, and have it follow `brain playbook verify`. The doc it writes under `features/<slug>/verifications/` must have:

- `- **Independence**:` in the header, naming who verified and confirming they did not implement. Self-verification is allowed only with a stated reason.
- An `## Acceptance criteria` table with **every** criterion as a row — the approved plan of record's phases plus each task's `acceptance` (and its `verify` contract line) — each walked, each with its own observed result. A row with no result is a failed row.
- A golden path, at least one error path, and edge probes. Browser-reachable steps get a screenshot; a criterion no browser reaches (CLI output, a file on disk) is checked by running its named command, and the evidence is the command, its exit code, and the observed output.
- `## Quality scores` for product-depth / functionality / design / code-quality, each 0–3, with floors of **2 / 2 / 2 / 1**. Design is N/A for non-UI work. Below any applicable floor = FAIL. A stub or display-only surface = FAIL.
- `- **Round**: N`. A FAIL goes back to the implementer, and each round gets a *fresh* verifier and its own doc: round 1 is `<YYYY-MM-DD>.md`, round N ≥ 2 is `<YYYY-MM-DD>-rN.md` with its screenshots `rN-`-prefixed, exactly one Verdict per doc (never an addendum). After 3 rounds, escalate to the human (`brain playbook execute` covers refine vs pivot).
- A receipt (`brain receipt --verified-by <verifier> --implemented-by <implementer>`) carrying `implemented_by` beside `verified_by`. If the two are equal, the CLI warns, and the Independence line must explain why. A defaulted `--verified-by` (git `user.name`, then `$USER`) never counts as independent — `check --strict` warns "identities not declared" — so the verifier passes its own name.

**Scale it to the plan tier.** For a **small**-tier plan, the contract review plus a single fresh sub-agent verifier pass over every acceptance row is enough; a FAIL still loops (fresh verifier per round, cap 3). For **full** tier, add a second adversarial pass on the riskiest tasks. Quality floors apply in both (`brain playbook execute`, AGENT TOPOLOGY). Harness rigor costs something, so spend it where the task is beyond what the model does reliably solo (`HARNESS.md` §6).

## 8. Close the run note

Append: what shipped, what's left, what surprised you.

## Definition of done

- [ ] Affected command(s) run: exit code + TOON + stderr verified
- [ ] `brain skill --check` green
- [ ] Browser walk done (if `brain review` touched) or skip justified
- [ ] Every diffed path → owning brain doc updated
- [ ] No non-negotiables grep hits
- [ ] `brain verify` + `brain check` green
- [ ] Independent verification PASS (if shipping/user-visible): Independence declared, every acceptance row walked, quality floors met, receipt has `implemented_by`
- [ ] Feature MD + `CHANGELOG.md` updated if applicable
- [ ] Throwaway test writes reverted file by file; real `.brain/` state left intact
- [ ] Run note closed (if opened)

Only after all boxes: report done.
