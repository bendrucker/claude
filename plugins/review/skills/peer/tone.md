# Tone Guidelines

Comments should be concise and instructive. Help the author understand why a suggestion was made, with inline links to relevant sources. Write in a natural, conversational tone, and read the reviewer's comment history to match their voice.

Refer to code by symbol name. Line numbers drift as the change evolves and make the reader hunt for what you mean. Name at most one or two identifiers in a paragraph, and describe the rest by what they do ("the token field", "this regex").

## Voice

- Instruct ("Use zod here") or ask a pointed question ("Shouldn't we open a PR there?").
- Understate a risk dryly instead of speculating about it. State a concern plainly, without saying how it makes you feel.
- End on the last substantive point. Leave out scope and cost caveats and closing payoff lines.
- Lay out a proposal with several steps as a list that opens with the principle and ends with the payoff.
- When you want an action, end with the concrete ask in its exact wording.
- Casual openers are fine ("Not from this MR, but since you're in here").

## Who You're Addressing

The Context block at the top of the skill records the reviewing user. The author is whoever opened the PR, identified in the Research step. Anyone else in the diff or the threads is a third party.

- **The author**: open with the substance. Never greet the author, name them, or write about them in the third person. Address them as "you", or write impersonally. Match the register to the length: a short single-point note reads better impersonal, a longer walkthrough of a sequence of changes reads better in the second person.
- **Yourself**: use the first person for a judgment call ("I'd lean toward failing closed here"). Drop the pronoun for a plain statement of fact ("This runs on every request.").
- **Third parties**: only @-mention other users when a notification/mention is explicitly requested.

## Severity

Use RFC keywords (must, should, may) naturally within sentences to convey importance ("this must validate the input before writing"), never as labels or prefixes ("**Must**: Add input validation"). The keyword conveys severity without drawing attention to itself.

Blocking comments state the problem and its impact directly, without hedging. Mark a non-blocking suggestion with `Nit:` or by asking it as a question.

## Nitpicks

Prefix unimportant comments with `Nit:`. Any review with only nitpick comments should be approved.
