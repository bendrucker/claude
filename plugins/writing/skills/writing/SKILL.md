---
name: writing:writing
description: >-
  Enforce direct, concise prose style and catch writing slop. Use when writing or editing PR descriptions,
  issue bodies, commit messages, documentation, Slack messages, or any human-facing text.
  Also use when asked to clean up, rewrite, or "de-AI" existing text.
---

# Writing

Write prose a person reads in a direct, conversational voice. The writing hooks lint saved files and outgoing messages against the Vale styles in [`styles/Writing/`](../../styles/Writing/). The text is done when every alert the hook reports on it is fixed.

## Voice

Every sentence teaches something new and holds only for this subject. Cut a sentence that restates the obvious or could move unchanged to another person, company, or product, or replace it with something true only of this subject.

- Prefer substance to filenames or implementation details.
- Prefer short sentences to compound constructions.

## Rules

#### Structure

- Use no spaced em dash (` — `).
- Write each independent clause as its own sentence. A clause joined by an em dash, semicolon, hyphen, or any connector swapped in for one becomes a sentence break. Keep a semicolon only when the clauses can't stand alone.
- State the point directly in place of "not just X, but also Y" parallelism.
- Name a heading's topic in a couple of words: a noun phrase, without verbs or a `Topic: clause` form. Put the explanation in the body.

#### Word Choice

- Use "is" or "are" where "serves as" or "stands as" would go.
- Write "use X" or "prefer X over Y" in place of "reaching for X".
- Name what you're examining in place of "dig into" or "dive into".
- State a claim directly, or name the uncertainty, in place of hedging verbs ("looks like", "appears to", "seems to").
- Negate the verb with a contraction: "doesn't cost an extra query", "doesn't need a change". A positive term works when it names the state exactly ("a no-op", "unchanged"). Plain statements like "has no tests" and "there is no lock" stay.
- Say why something matters in place of gravity markers ("load-bearing", "the honest answer", "worth noting/flagging", "the full picture", "the cleanup story"): name what breaks without the dependency, or state the fact plainly.

#### PR and Review Prose

- Open a published comment on the substance, without a greeting or a name. Refer to people in third person by their username as written.
- Use active voice: "Adds X" in PR and review prose, "Add X" in commit subjects, "Added tests covering X" for tests.
- Describe what the tests cover in place of test counts, pass/fail tallies, or CI status.
- End a sentence on its content, without a trailing hedge adverb ("regardless.", "nonetheless.").
- State the positive directly in place of contrast by negation, whether across sentences ("It isn't X. It is Y.") or inline (`X, not Y`).

#### Email and Messages

- Match the sender's plain voice in human-facing email: ordinary paragraphs in place of dramatic one-sentence paragraphs, rhetorical question then answer ("The result? X."), or escalating triads.
