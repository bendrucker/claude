---
name: writing:writing
description: >-
  Enforce direct, concise prose style and catch writing slop. Use when writing or editing PR descriptions,
  issue bodies, commit messages, documentation, Slack messages, or any human-facing text.
  Also use when asked to clean up, rewrite, or "de-AI" existing text.
---

# Writing

## Patterns to Avoid

The hook enforces most of these automatically; the rest ship in the scan and review skills. Specific vocabulary and marketing-verb lists live in [`wordlists/`](../../wordlists/).

#### Structure

- Never use spaced em dashes (` — `).
- Avoid "not just X, but also Y" parallelism. Simplify.
- Don't join independent clauses with em dashes, semicolons, or hyphens. Write two sentences. Swapping one connector for another is not a fix. A rare semicolon is fine only when the clauses genuinely can't stand alone.
- Headings name the topic in a couple of words. No verbs, no `Topic: clause`, no sentence-shaped headings. Move the explanation into the body.

#### Word Choice

- Don't replace "is"/"are" with "serves as" or "stands as".
- Don't write "reaching for X." Use "use X" or "prefer X over Y."
- Don't write "dig into" / "dive into." Name what you're looking at.
- Hedging verbs ("looks like", "appears to", "seems to") are vague. State directly or name the uncertainty.
- No gravity markers. "Load-bearing", "the honest answer", "worth noting/flagging", "the full picture", and "the cleanup story" all assert that something matters instead of saying why. Replace each with its substance: name what breaks without the dependency, state the fact plainly, make the point without announcing it.

#### PR and Review Prose

- Active voice in PR and review prose. Not "X is added" but "Adds X." Commit subjects take the imperative: "Add X".
- Not "Tests cover X" but "Added tests covering X."
- No trailing hedge adverbs ("regardless.", "nonetheless.").
- No cross-sentence negation ("It isn't X. It is Y."). Combine or drop the negation.
- No test counts, pass/fail tallies, or CI status. Describe what the tests cover.
- No `X, not Y` contrast. State the positive directly.

#### Outbound Email and Messages

- Don't write human-facing email in a punchy journalistic cadence: dramatic one-sentence paragraphs, rhetorical question then answer ("The result? X."), or escalating triads. Match the sender's plain voice.

## Voice

Direct, conversational. Every sentence should teach something new. Cut words that restate the obvious.

- Substance over filenames or implementation details
- Shorter sentences over compound constructions
