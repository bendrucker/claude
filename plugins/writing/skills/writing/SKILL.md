---
name: writing
description: >-
  Enforce direct, concise prose style and catch writing slop. Use when writing or editing PR descriptions,
  issue bodies, commit messages, documentation, Slack messages, or any human-facing text.
  Also use when asked to clean up, rewrite, or "de-AI" existing text.
---

# Writing

## Patterns to Avoid

The hook enforces these automatically. Vocabulary and marketing-verb lists are in [`wordlists/`](../../wordlists/). Refer to those files for specific words rather than memorizing them here.

#### Structure

- Never use spaced em dashes (` — `). Use commas, colons, or parentheses.
- Avoid "not just X, but also Y" parallelism. Simplify.
- Avoid semicolons. Prefer shorter sentences or commas.
- Don't structure bullets as `- **path/to/file**: description`.
- Use `####` headers instead of `**Label:**` for labeled subsections.

#### Word Choice

- Don't replace "is"/"are" with "serves as" or "stands as".
- Don't write "reaching for X." Use "use X" or "prefer X over Y."
- Don't write "dig into" / "dive into." Name what you're looking at.
- Hedging verbs ("looks like", "appears to", "seems to") are vague. State directly or name the uncertainty.

#### PR and Review Prose

- Active voice. Not "X is added" but "Adds X."
- Not "Tests cover X" but "Added tests covering X."
- No trailing hedge adverbs ("regardless.", "nonetheless.").
- No cross-sentence negation ("It isn't X. It is Y."). Combine or drop the negation.

#### Outbound Email and Messages

- Don't write human-facing email in a punchy journalistic cadence: dramatic one-sentence paragraphs, rhetorical question then answer ("The result? X."), or escalating triads. Match the sender's plain voice.

## Voice

Direct, conversational. Every sentence should teach something new. Cut words that restate the obvious.

- Substance over filenames or implementation details
- Shorter sentences over compound constructions
