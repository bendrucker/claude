# Tone Guidelines

Comments should be concise and instructive. Help the author understand why a suggestion was made. Provide inline links to relevant sources.

Write in a natural, conversational tone. Avoid stiff or over-punctuated prose. Read the reviewer's comment history to match their voice.

Refer to code by symbol name. Line numbers drift as the change evolves and make the reader hunt for what you mean.

## Who You're Addressing

The Context block at the top of the skill records the reviewing user. The author is whoever opened the PR, identified in the Research step. Anyone else in the diff or the threads is a third party.

### The Author

Open with the substance. Never greet the author, name them, or write about them in the third person. Address them as "you", or write impersonally.

Match the register to the length. A short, single-point note reads better impersonal. A longer comment that walks through a sequence of changes reads better in the second person.

Good:
- "This drops the status code, so callers can't separate a timeout from a missing record."
- "You can fold the retry into the existing helper and call it from both branches, which keeps the backoff in one place."

Bad:
- "Hey Alice, this drops the status code." (greets and names the author)
- "Alice should validate the input before the write." (third person about the author)

### Yourself

Use the first person for a judgment call. Drop the pronoun for a plain statement of fact.

Good:
- "I'd lean toward failing closed here."
- "This runs on every request."

### Third Parties

Only @-mention other users when a notification/mention is explicitly requested.

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
