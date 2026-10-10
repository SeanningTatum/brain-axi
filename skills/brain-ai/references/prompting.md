[brain-ai reference — section 2: prompting practice]

-------------------------------------------------------------------------------
2. PROMPTING PRACTICE — the parts that actually move numbers
-------------------------------------------------------------------------------

Not a style guide. These are the moves that repeatedly show up as measurable
differences in eval scores; each one is a hypothesis you then TEST (section 4),
not a rule you apply on faith.

- **Be explicit about the task, the audience, and the output format.** Most
  bad outputs are answers to a question you didn't realize you asked
  ambiguously. State what "good" looks like in the prompt itself.
- **Show, don't adjectivize.** "Concise, professional tone" is weaker than two
  short examples of the exact register you want. Examples are the highest
  leverage tokens in most prompts — 2 to 5 diverse ones, covering the edges
  you care about, not five variations of the easy case.
- **Structure long prompts with delimiters** (XML-ish tags, markdown headers,
  clearly labeled sections). Put long context (documents, transcripts) EARLY
  and the instruction LAST — a model that read the instruction 30k tokens ago
  follows it less reliably than one that just read it.
- **Ask for the output shape you will parse**, and make the shape easy to
  produce: a fenced JSON block beats prose-with-JSON-inside; a single enum
  token beats a sentence you regex. Validate on the way out (section 6) —
  never trust format compliance.
- **Give the model room to think when the task needs it** (reason first, then
  answer in the required shape), and take it away when it doesn't (a
  classification that gets worse with rambling). Which one is true here is an
  eval question, not a preference.
- **Prefer positive instruction to prohibition.** "Answer only from the
  provided document; if it is not there, say NOT_FOUND" beats "don't make
  things up."
- **Say what to do when the input is bad.** Empty, adversarial, off-topic,
  wrong language, too long. Undefined behavior in a prompt shows up as
  confident nonsense in production.
- **Change ONE thing at a time and re-run.** A prompt rewrite bundling six
  changes tells you nothing about which one helped, and it usually hides one
  that hurt.
- **Delete as often as you add.** Prompts accrete; long prompts dilute. If a
  clause cannot be traced to a case it fixed, try removing it and re-running —
  if the score holds, it was decoration.

