[brain-execute reference — evidence discipline — re-execute, don't read]

-------------------------------------------------------------------------------
EVIDENCE DISCIPLINE — RE-EXECUTE, DON'T READ
-------------------------------------------------------------------------------

Three real failures from one session of running this exact loop, kept here
because a description of the failure mode is easy to nod along with and easy
to repeat anyway:

- A worker's summary said it "reused" an existing definition. The diff
  showed it had COPIED the definition instead — twice, in the same session,
  once for a field list and once for a commit-hash pattern. Reading a
  summary cannot tell "reused" from "copied"; only the diff can, because the
  distinction IS the diff.
- A worker's test simulated a concurrency bug SEQUENTIALLY and passed
  against code later measured to fail 5-of-5 under genuine concurrency. A
  test that reproduces a bug's shape but not its timing has proven nothing
  about the timing-dependent bug it claims to cover.
- A commit message asserted a specific behavior ("an age-based breaker for a
  SIGKILLed holder") that no assertion in the diff actually covered. Prose
  in a commit message is a claim about evidence, not evidence.

One root cause underlies all three: a report was READ and believed instead
of RE-EXECUTED and checked. So, whichever role you are in:

- **"I reused X"** → diff it against the thing it claims to reuse. A copy
  reads identically to a reuse in prose and never in a diff.
- **"this reproduces bug Y"** → check whether the test's actual mechanism
  can trigger Y's failure mode. A sequential test cannot prove a race is
  fixed; run it concurrently, or don't claim the race is covered.
- **"this commit does Z"** → find the assertion that fails when Z is false.
  No such assertion means no such claim — either add one or say plainly that
  Z is unverified.
- Accepting a worker's `--evidence`, or your own, is never "the summary
  sounded right" — it is re-running the command whose output is being
  quoted and reading THAT output.

