---
name: plan:grill
description: |
  Relentless design-tree interview. Walks the dependency tree one question at a time via AskUserQuestion, drilling into whatever the prior answer opens up, until you and the user share understanding of the design, then ends with a decisions digest. Use when the user asks to be grilled, interviewed, or pushed on a design or plan ("grill me", "interview me on this", "pressure-test this design"), or when another skill hands off its planning interview. Reserve for a change that warrants being pushed past a first answer.
context: fork
agent: Plan
---

# Grill Me

Interview the user about their requested change via `AskUserQuestion`, one question at a time, until you both understand the design.

## Rules

- One question per `AskUserQuestion` call. Two only for genuinely independent sibling branches of the same node — never four, never a batch by topic.
- Never list questions in chat prose.
- No fixed number of calls. Keep drilling until the design tree is settled, not until a quota is hit.

## Walk the Tree

Each question comes from the prior answer, not a pre-planned batch. An answer opens a dependency: pull on it before moving to a sibling question. Don't advance until the current branch is resolved.

Facts come from reading the code yourself: grep the call sites, read the config, check what already exists. Decisions come from the user. Never ask for something you can find out by reading.

## Open-Ended Questions

Sketch 2-4 plausible options. The user gets "Other" automatically (do not add it). If you cannot name two genuinely distinct options, read more code or ask a more foundational question first.

Options must be opposed positions, not near-synonyms. A question whose options amount to the same decision is a de-fanged multiple choice, and it defeats the interview.

When you have a recommendation, put it first and append "(Recommended)".

## Fast Picks and Conflicts

A quick, confident pick can still contradict an earlier answer. When it does, don't proceed on the new answer as given: challenge the conflict directly on the next call and let the user resolve it.

## Output

End with a decisions digest as the final message, one entry per decision:

- **Decision**: the position chosen
- **Rejected**: the alternatives considered, and why they lost
- **Why**: the reasoning behind the chosen position

This is an ADR-lite, not an implementation plan. Nothing in it is enacted until the user confirms.
