---
name: grill-docs
description: Run the grilling interview and write each settled term and decision to the repo as it settles, so they survive compaction or an abandoned session.
argument-hint: "[<what to grill>]"
disable-model-invocation: true
allowed-tools:
  - AskUserQuestion
  - Agent
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

# Grill With Docs

Run the `grilling` skill's interview over $ARGUMENTS, and write each term and decision to disk as soon as it is settled.

Writing as we go is the point. If the session is compacted or abandoned, the repo still holds what we agreed.

## Where It Lands

Choose both destinations before the first round and say them back to me.

Terms go where the repo already keeps instructions Claude loads automatically:

- A term that applies to one part of the repo goes in `.claude/rules/<area>.md` under a `paths` entry, so it loads when that part is touched.
- A term that applies everywhere goes in `CLAUDE.md`.
- Create the file if it does not exist.

Decisions go beside the plan that produced them, as `<plan>-decisions.md` in the same directory.

## Vocabulary

Write a term as soon as it is settled, which means I have picked both the word and its meaning.

Prefer a word the codebase already uses. When the question is what to call something, search the codebase for candidates first and offer those as the options.

A definition says what the thing is and how it differs from the thing it is most easily confused with. Keep it to that.

## Decisions

Record a decision when all three hold:

- Reversing it later would be expensive.
- Someone who was not in this conversation would not guess it.
- It was a tradeoff: a reasonable alternative was rejected.

Most sessions produce no decision that meets all three, and that is expected.

A record states the decision, the alternatives it rejects, and the tradeoff.

## Close

Write the interview's closing escalation contract (what to proceed on without asking, what to stop and consult on) into the decisions file, then wait for me to confirm it.
