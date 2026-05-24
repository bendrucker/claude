---
name: writing
description: >-
  Write like Ben Drucker. Use when writing or editing PR descriptions,
  issue bodies, commit messages, documentation, Slack messages, or any human-facing text.
  Also use when asked to clean up, rewrite, or "de-AI" existing text.
user-invocable: false
---

# Writing

## Patterns to Avoid

#### Em Dashes

Never use spaced em dashes (` — `). This is the most recognizable AI writing tell.

- Use unspaced em dashes: `word—word`
- Or rewrite with commas, colons, or parentheses

#### Vocabulary

These words are strongly associated with AI-generated text. The full list lives in [`wordlists/vocabulary.txt`](../../wordlists/vocabulary.txt). Matching uses a Porter stemmer, so inflected forms (`meticulously`, `garnered`, `fostering`) are caught automatically from base entries. Highlights:

- delve, tapestry, landscape (figurative), meticulous
- pivotal, testament, underscore (figurative), interplay, intricacies
- myriad, plethora, seamless, holistic, synergy, robust, comprehensive
- leverage (verb, figurative), realm, mosaic, beacon

#### Copula Avoidance

Do not replace "is" or "are" with fancier constructions:

- "serves as" -> "is"
- "stands as" -> "is"

#### Sycophantic Openers

Don't start a message or sentence with `Perfect.`, `Excellent.`, `Great.`, `Wonderful.`, `Absolutely.`, `Fantastic.`, `Amazing.`, `Awesome.`, `Brilliant.`. Open with the substance. Full list in [`wordlists/openers.txt`](../../wordlists/openers.txt).

#### Conversational Patterns (Bash/MCP Only)

The following patterns are scoped to side-effect tools (Slack messages, PR bodies, issue comments) where pasted assistant prose is the concern. They don't fire on file writes.

- **Sycophantic acknowledgments**: "you're right", "you're absolutely right." Move directly to the correction.
- **Permission-seeking**: "want me to ...?" Take the next step, or state options crisply.
- **Hedging closes**: "would you like ...?" State the next step directly.
- **"I understand"**: sycophantic preamble. Move to the substance.


#### "Reaching for"

Don't write "reaching for X" as figurative use. Prefer "use X" or "prefer X over Y."

#### Marketing Verbs

Verbs like `empower`, `streamline`, `generalize`, `unlock`, `elevate`, `transform`, `enhance`, `optimize` (used figuratively) read as promotional. The hook grades them by promotional intensity in [`wordlists/marketing-verbs.txt`](../../wordlists/marketing-verbs.txt) and flags a context-tier reminder when they stack. Describe concretely what changed.

#### Hedging Observation

"looks like", "appears to", "seems to" are AI-typical hedges. State the observation directly, or name the actual uncertainty.

#### "Dig into" / "dive into"

Filler for exploration. Describe what you're actually looking at.

#### Cross-Sentence Negation

"It isn't X. It is Y." reads as AI rhetorical pacing. Combine into one sentence or drop the negation.

#### Promotional Language

Avoid marketing-style adjectives and verbs:

- boasts, vibrant, showcasing, nestled, groundbreaking, renowned, diverse array

#### Parallelism

Avoid the "not just X, but also Y" construction. Simplify.

#### Semicolons

Semicolons are not wrong but AI overuses them. Prefer shorter sentences or commas. If you find yourself using more than one semicolon in a paragraph, rewrite.

#### Passive Voice in PR Summaries

Don't write "X is added," "Y was refactored." Rewrite so something is doing the verb.

#### "Tests cover ..." Preamble

`Tests cover ...` elides the subject. Use `Added tests covering ...` or describe the change.

#### `**path**: description` Bullets

Don't structure markdown bullets as `- **path/to/file**: description`. Describe the conceptual change in prose.

#### Trailing Hedge Adverbs

`regardless.`, `nonetheless.`, `anyway.` at sentence end is AI hedging. Drop or rewrite the clause.

#### `**Label:**` Outside Code

Use `####` headers instead of `**Label:**` for labeled subsections.

## Voice

Write in a direct, conversational tone. Every line should teach the reader something new. Remove words that state the obvious or pad length.

- Focus on substance over filenames or implementation details
- Prefer shorter sentences over compound constructions
- Do not over-explain

## When Cleaning Up Existing Text

Scan the target text for the patterns above. Replace each instance with natural alternatives. Prefer the simplest rewrite that preserves meaning.
