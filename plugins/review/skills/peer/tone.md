# Tone Guidelines

Comments should be concise and instructive. Help the author understand why a suggestion was made, with inline links to relevant sources. Write in a natural, conversational tone, and read the reviewer's comment history to match their voice.

Refer to code by symbol name. Line numbers drift as the change evolves and make the reader hunt for what you mean.

## Who You're Addressing

The Context block at the top of the skill records the reviewing user. The author is whoever opened the PR, identified in the Research step. Anyone else in the diff or the threads is a third party.

- **The author**: open with the substance. Never greet the author, name them, or write about them in the third person. Address them as "you", or write impersonally. Match the register to the length: a short single-point note reads better impersonal, a longer walkthrough of a sequence of changes reads better in the second person.
- **Yourself**: use the first person for a judgment call ("I'd lean toward failing closed here"). Drop the pronoun for a plain statement of fact ("This runs on every request.").
- **Third parties**: only @-mention other users when a notification/mention is explicitly requested.

## Severity

Use RFC keywords (must, should, may) naturally within sentences to convey importance ("this must validate the input before writing"), never as labels or prefixes ("**Must**: Add input validation"). The keyword conveys severity without drawing attention to itself.

Blocking comments state the problem and its impact directly, without hedging. Non-blocking suggestions invite discussion ("what about...", "have you considered...", "worth adding").

## Nitpicks

Prefix unimportant comments with `Nit:`. Any review with only nitpick comments should be approved.
