---
name: grilling
description: Interrogate a plan, decision, or idea round by round until every open decision is settled and nothing is silently assumed. Use when the user says grill me, grill this, stress-test this, poke holes in this, or wants their thinking interrogated before committing to it.
argument-hint: "[<what to grill>]"
allowed-tools:
  - AskUserQuestion
  - Agent
---

# Grilling

Interview me about $ARGUMENTS until we reach a shared understanding. Do not act on it until I confirm we have.

Map the subject as a design tree: every decision branches into the decisions that hang off it. The frontier is every decision whose prerequisites are already settled, so its questions can be asked now without guessing at answers you have not heard. Work the frontier in rounds.

The decisions are mine. The facts are yours.

## Question Shape

Every round's questions follow my standing `AskUserQuestion` rules:

!`grep '^- ' ~/.claude/skills/ask/SKILL.md 2>/dev/null || echo '- **Fallback: no rule bullets found in ~/.claude/skills/ask/SKILL.md.** One question per open decision, a recommended option on every question, and split the batch when a follow-up depends on an earlier answer.'`

## Rounds

Ask the whole frontier in one round. `AskUserQuestion` caps a call at four questions, so when the frontier is wider, ask the four whose answers settle the most branches below them and name the deferred ones in prose. A question whose answer depends on another question open in this round belongs to a later round.

Say what the round is deciding before you call the tool. The widget renders the question and its options and nothing else, so the reasoning that led to this round has nowhere else to go.

Never ask whether to proceed. Permission to continue is not a decision.

Each round reshapes the tree. Settled decisions push the frontier outward and unblock what depended on them. Recompute it before asking again.

## Finding Facts

Finding facts is your job. Never ask me for anything the repo, the filesystem, or a CLI can answer. Dispatch an `analyst` subagent on `haiku` or `sonnet` for each lookup and name what you sent it after.

Do not block on it. A running lookup is an unsettled prerequisite, so only the questions downstream of it wait. Ask the rest of the frontier now.

## Options

Three options per question is the target and four is the ceiling. Across 2,398 questions asked this way, four-option questions came back overridden 43% of the time against 18% at two options, and a fifth option errors the call before I ever see it. A decision that needs five positions is two decisions.

Reserve `multiSelect` for coarse picks off a flat list. Where the items interact, I answer by restructuring the set rather than ticking boxes, which means the decision was never a checklist.

## Reading Answers

- A note with no option selected rejects the framing, not the difficulty. Rebuild that branch of the tree. Do not re-ask the same question with the same options.
- An answer that ignores what you asked and supplies new facts or a scope change is still an answer. Fold it in and keep going.
- "Just do it", "figure it out", or a bare "yes" ends the round. Either it was already settled in something I said, or it is mechanical. Stop asking and act.
- I override questions individually inside a batch. A note on one is not a rejection of the others.

## Close

The session ends when the frontier is empty, with every branch visited and nothing left silently assumed. Close it with an escalation contract covering the work we just settled:

```
Proceed without asking on: <the execution that matches what we agreed>
Stop and consult on:
- <each irreversible or outward-facing step>
- <each unknown the whole approach rests on>
```

Reversibility and blast radius draw that line, not subject matter. Then wait for me to confirm before acting on any of it.
