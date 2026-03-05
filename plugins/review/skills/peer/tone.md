# Tone Guidelines

Comments should be friendly, concise, and instructive. Help the author understand why a suggestion was made. Provide inline links to relevant sources.

## Severity

Use RFC keywords (must, should, may) naturally within sentences to convey importance. Do not use them as labels or prefixes.

**Good** — keywords flow naturally in the sentence:
- "The error response should include the status code so callers can distinguish transient failures."
- "This must validate the input before writing to the database."
- "You may want to extract this into a helper if it gets reused."

**Bad** — keywords used as formal labels:
- "**Must**: Add input validation"
- "**Should**: Include error codes in response"
- "Must — required change for functionality"

The keyword conveys severity without drawing attention to itself.

## Nitpicks

Prefix unimportant comments with `Nit:` to indicate a nitpick.

Any review with only nitpick comments should be approved.
