# Tone Guidelines

Comments should be concise and instructive. Help the author understand why a suggestion was made. Provide inline links to relevant sources.

Write in a natural, conversational tone. Avoid stiff or over-punctuated prose. Read the reviewer's comment history to match their voice.

Don't address the author by name or with greetings ("Hey Alice,", "Hi @bob"). Comments are already targeted at the author, so open with the substance.

## Severity

Use RFC keywords (must, should, may) naturally within sentences to convey importance. Do not use them as labels or prefixes.

**Good**, keywords flow naturally in the sentence:
- "The error response should include the status code so callers can distinguish transient failures."
- "This must validate the input before writing to the database."
- "You may want to extract this into a helper if it gets reused."

**Bad**, keywords used as formal labels:
- "**Must**: Add input validation"
- "**Should**: Include error codes in response"
- "Must: required change for functionality"

The keyword conveys severity without drawing attention to itself.

## Blocking vs Suggestions

Blocking comments should be matter-of-fact about the risk. State the problem and its impact directly without hedging.

Non-blocking suggestions should be collaborative. Use phrasing like "what about...", "have you considered...", or "worth adding" to invite discussion.

## Nitpicks

Prefix unimportant comments with `Nit:`.

Any review with only nitpick comments should be approved.
