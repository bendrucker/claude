---
name: grilling
description: Interrogate a plan, decision, or idea round by round until every open decision is settled and nothing is silently assumed. Use when the user says grill me, grill this, stress-test this, poke holes in this, or wants their thinking interrogated before committing to it.
argument-hint: "[<what to grill>]"
allowed-tools:
  - AskUserQuestion
  - Agent
---

# Grilling

Interview me about $ARGUMENTS until we reach a shared understanding. Act on it only after I confirm we have.

Map the subject as a design tree: every decision branches into the decisions that hang off it. The frontier is every decision whose prerequisites are settled. Work the frontier in rounds.

## Question Shape

Every round's questions follow my standing `AskUserQuestion` rules:

!`grep '^- ' ~/.claude/skills/ask/SKILL.md 2>/dev/null || echo '- **Fallback: no rule bullets found in ~/.claude/skills/ask/SKILL.md.** One question per open decision, a recommended option on every question, and split the batch when a follow-up depends on an earlier answer.'`

## Rounds

Ask the whole frontier in one round. `AskUserQuestion` caps a call at four questions, so when the frontier is wider, ask the four whose answers settle the most branches and name the deferred ones in prose. A question that depends on another open question waits for a later round.

Before each call, say in prose what the round is deciding, because the widget shows only the questions and options.

Every question settles a decision. Continue between rounds without asking permission.

Recompute the frontier after each round.

## Finding Facts

The decisions are mine. The facts are yours: answer from the repo, the filesystem, or a CLI rather than asking me. While a lookup runs, ask the frontier questions that do not depend on it.

## Options

Give three options per question, four at most. A fifth option errors the call. A decision that needs five positions is two decisions.

Use `multiSelect` only for coarse picks off a flat list of independent items.

## Reading Answers

- A note with no option selected rejects the framing. Rebuild that branch with new options.
- An answer that supplies new facts or a scope change instead of a pick is still an answer. Fold it in.
- "Just do it", "figure it out", or a bare "yes" ends the questioning on that topic. Act on it.
- I override questions individually inside a batch. A note on one leaves the others answered.

## Close

The session ends when the frontier is empty, with every branch visited and nothing silently assumed. Close with an escalation contract covering the work we settled:

```
Proceed without asking on: <the execution that matches what we agreed>
Stop and consult on:
- <each irreversible or outward-facing step>
- <each unknown the whole approach rests on>
```

Draw the line by reversibility and blast radius, not subject matter. Then wait for my confirmation before acting.
