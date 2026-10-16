[brain-ai reference — section 4: eval design]

-------------------------------------------------------------------------------
4. EVAL DESIGN — pick the cheapest thing that discriminates
-------------------------------------------------------------------------------

Three kinds, in ascending order of cost and descending order of reliability.
Use the cheapest one that actually separates good output from bad:

1. **Deterministic assertions** — schema validity, required substring, regex,
   numeric range, length cap, "parses as JSON", exact match on a classification
   label. Fast, free, reproducible. Most quality bars decompose into more of
   these than people expect. Start here.
2. **Rubric + LLM judge** — for free-form quality (helpfulness, tone,
   faithfulness to a source). Write the rubric as explicit criteria with a
   small scale (0-2 or 0-3, not 1-10 — models do not have ten calibrated
   levels), and demand a short rationale before the score.
3. **Human** — for the things a judge cannot see yet: taste, brand voice, "is
   this actually useful." Expensive, so spend it on a sample and on
   calibration, not on every run.

Rules that apply to all three:

- **Sanity-check the metric before you trust it: deliberately degrade the
  prompt and confirm the score drops.** A metric that does not move when
  quality moves is worse than no metric — it launders bad changes as safe.
- **Judge calibration is a recommendation, not a gate — but do it early.**
  Label a slice by hand, compare against the judge, and write down the
  agreement rate. "The judge agrees with me on 84% of cases" makes every later
  score interpretable; an uncalibrated judge score is a number with no units.
  Judge with a different model (or at minimum a different prompt) than the one
  under test.
- **Control nondeterminism.** Temperature 0 where the task allows it; where it
  does not, run each case N times and report pass rate, not a single sample.
  A "regression" that is one unlucky sample wastes a session; a real
  regression hidden by one lucky sample ships.
- **Record cost and latency alongside quality.** A prompt that scores 2 points
  higher and costs 3x is a decision, not an improvement — surface it as one.

