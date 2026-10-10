[brain-verify reference — section 6: persist the evidence]

-------------------------------------------------------------------------------
6. PERSIST THE EVIDENCE (brain-axi commands)
-------------------------------------------------------------------------------

Copy each screenshot in with the naming convention baked into --step:

    npx -y brain-axi shots add ./01-signup.png --feature authentication --step 01-signup
    npx -y brain-axi shots add ./02-dashboard.png --feature authentication --step 02-dashboard
    npx -y brain-axi shots add ./E1-bad-login.png --feature authentication --step E1-bad-login

This lands each file at
.brain/features/<slug>/screenshots/<step>.<ext> — write the verdict doc's
table links as relative paths from the verifications/ dir: ../screenshots/<step>.<ext>.

Round N >= 2: prefix every --step with rN- (`--step r2-01-signup`,
`--step r2-E1-bad-login`). `shots add` overwrites an existing step's file,
so reusing round 1's step names would silently replace the images round 1's
doc cites — the FAIL evidence the re-walk exists to answer. Link round N's
doc to its own rN- files only.

Then write the verdict doc itself to
.brain/features/<slug>/verifications/<YYYY-MM-DD>.md (today's date; round
N >= 2 is <YYYY-MM-DD>-rN.md — one Verdict per doc, never an addendum). There is
no CLI write command for the doc body — write the file directly with your
file-editing tool, following the structure above.

Confirm it's discoverable:

    npx -y brain-axi verifications <slug>
    npx -y brain-axi verifications view <slug> <YYYY-MM-DD>   (or <YYYY-MM-DD>-rN)

Both should show your new doc with the correct verdict parsed from the
**Verdict** line. Then bind it to the code with a receipt naming BOTH sides:

    npx -y brain-axi receipt <slug> --verified-by <you> --implemented-by <who wrote it>

(`--implemented-by` defaults to HEAD's git author, `--verified-by` to
`git config user.name`, then `$USER` — so a solo human stamping with defaults is caught
as self-verified. A sub-agent verifier shares your git identity: always pass
its own name via `--verified-by`. The receipt records each name's source
— `verified_by_source` / `implemented_by_source`: `flag` or `default` —
and a defaulted `verified_by` never counts as independent: `brain check
--strict` warns "identities not declared" even when the names differ, and
the receipt's `warning:` says "identities defaulted" unless both flags are
passed.) If the two are the same identity the receipt still stamps but
prints a `warning:`, and `brain check --strict` reports a `warn` row;
that must be matched by your `- **Independence**: self-verified — <reason>`
line. If a checkpoint is warranted, follow up with
`brain progress add --summary "..."` noting the verification result.

