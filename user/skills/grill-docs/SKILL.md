---
name: grill-docs
description: Run the grilling interview and write what it settles to the repo as it settles, so the vocabulary and the decisions outlive the session window.
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

Run the `grilling` skill's interview over $ARGUMENTS, and write what it settles to disk at the moment it settles.

Writing as we go is the whole difference. A session that gets compacted or abandoned still leaves the repo holding what we agreed.

## Where It Lands

Choose both destinations before the first round and say them back to me.

Vocabulary goes where the repo already keeps standing context:

- A term governing one area of the tree goes in `.claude/rules/<area>.md` under a `paths` entry, so it loads when that area is touched.
- A term governing the whole repo goes in `CLAUDE.md`.
- Where the fitting file is missing, create that one.

Decisions go beside the plan that produced them, as `<plan>-decisions.md` in the same directory.

## Vocabulary

Write a term the moment it resolves. A term is settled once I have picked both the word and what it denotes.

Prefer a word already in the codebase. When a decision turns on what to call something, go find the candidates first and make them the options.

A definition says what the thing is and what separates it from its nearest neighbor. Keep it to that.

## Decisions

Record a decision when all three hold:

- Reversing it later costs real work.
- It would surprise someone arriving without this conversation.
- Something real was given up to make it.

Most sessions clear none of these. That is the gate working, so hold it where it is.

A record states the decision, what it rules out, and what it cost.

## Close

Write the escalation contract into the decisions file, then wait for me to confirm it.
