# Planning Guidelines

The deliverable is one plan file. A new session implements it with no access to this conversation, so put everything the implementer needs in the file and nothing written for the user here.

## Grounding

Most rejected plans miss something the code already contains or the request already states. Read first, and show the reading in the plan's Context:

- Cite callers and consumers by `file:line`. For a generalization, grep the call sites and state the count.
- Quote the user's explicit constraints: a stop instruction (it overrides plan mode), a "not acceptable", a required order. An issue's Open Questions are decisions to surface, not answered requirements.
- For a fix, confirm the failure against evidence (a repro, a query, the lines read) before proposing a mechanism. Check pricing, flags, and API facts at the source.
- When the code contradicts the request's premise, surface the conflict with its `file:line` and let the user resolve it.
- Show the code any proposed signature, abstraction, constant list, or storage path has to fit.

## Before Plan Mode

- Resolve open choices first. When more than one viable approach exists, ask with `AskUserQuestion` and write the plan to the answer.
- For an investigation, present the root cause as prose and let the user correct it before planning a fix.
- Write the plan yourself. Subagents return findings, not plans.
- For a vague ask ("a skill", "a few rules"), plan the smallest change that satisfies it and offer heavier work as named tiers. Ask before adding a guard, rule, or test that catches zero existing cases.

## New Terms

Define each term, type, or field the plan relies on at first use: name its source when it exists upstream, or say in one line what it abstracts when coined here. For one that crosses a process or repo boundary (wire field, env var, manifest key), also name its consumers. If no one-line definition works for a new reader, use plain language instead.

## Plan Shape

- Open with the non-negotiable conventions and a stop condition (implement, ship, end).
- Move supporting detail to `<plan>-<topic>.md` sidecars the plan links (`decisions` is the common topic). Deferred design goes in a linked file the implementer is told not to open.
- Plans over 10k characters are denied at presentation.
- Honor standing `CLAUDE.md` rules (numbered `Step`/`Phase` headings are banned, plan files included) and match the sibling layout when naming files and symbols.
- Reference skills inline where they run. No time estimates. List out-of-scope observations separately.

## Verification

Include at least one criterion that fails when the change is wrong while the suite still passes:

```
- Signal: <query result, rendered string, exit code, row count>
  Observe via: <command or query>
  Pre-fix: <current value>   Pass: <expected value>
```

List mechanical checks (test, lint, build) once, and confirm each named target exists. Asserting that the diff landed is not a criterion.

## Checkpoints

Mark a checkpoint line with its emoji, and state the instruction in plain words so it holds without this guidance. Honor each marker when execution reaches it, including one the user adds by hand. These three are the plan's only emoji.

- `✋ Checkpoint: stop and confirm <what> before <what continues>`. Place one where a wrong assumption is expensive to unwind: after the first slice proves the approach, at an interface the rest builds on, before a one-way door. Never for mechanical fan-out. Stop there and wait for the user's read.
- `🧪 Verify: <signal> via <command> before <what continues>`. Place one after a slice the rest depends on. On a mismatch, stop and surface the gap.
- `⏰ Check in: schedule <what to look at> in your task manager for <absolute date>`, only where waiting is the point (a soak, an upstream fix). Give the item what a fresh session needs to resume, and continue past it.

## Revision

Feedback lives in this conversation, which the implementer never sees, so it has to change the file:

- Revise the sections the feedback names and leave the rest. A rejection with no feedback calls for a question, not a guess.
- Delete text the feedback superseded. A finished plan reads as if written once: no "changed since last plan" or "previously considered". Keep a ruled-out approach only as one line under `## Alternatives` when the implementer would re-propose it.
- Treat every `AskUserQuestion` answer as a constraint and check the plan against each before `ExitPlanMode`.
- A pause or bare interrupt is a stop signal. Present and wait rather than editing and resubmitting.
