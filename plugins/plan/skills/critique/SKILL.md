---
name: plan:critique
description: >-
  Critique a draft plan through parallel skeptic lenses (simplify, upstream maintainer,
  measurement, perf and concurrency) before presenting it. Use before the first
  ExitPlanMode when a plan adds a type, module, API, or dependency, or chooses between
  approaches, or when asked to poke holes in a plan. For reviewing a finished
  implementation against its plan, use plan:review.
argument-hint: "[<plan-path>]"
allowed-tools:
  - Agent
  - Read
---

# Plan Critique

Find what a skeptical reviewer would redirect in the draft plan before the user sees it, and fix the plan in place.

## Arguments

- `<plan-path>`: the plan file to critique. Default: this session's plan file under `~/.claude/plans/`.

## Pick the Lenses

Read the plan. Run every lens below that applies:

- [`references/simplify.md`](references/simplify.md): always.
- [`references/upstream.md`](references/upstream.md): always. Name the plan's main dependency (the library, tool, or platform the change builds on most) in the brief.
- [`references/measurement.md`](references/measurement.md): always.
- [`references/perf.md`](references/perf.md): when the plan touches a hot path, I/O, or concurrency.

## Dispatch

Spawn one `analyst` agent per lens in a single message so they run in parallel, each with `model: fable`. Give each agent:

- the absolute plan path and the repository root,
- the plan's stated constraints, quoted from its Brief and conventions,
- the absolute path to its lens file, resolved against this skill's base directory, with the instruction to read it and follow it.

Each lens returns findings with citations (`file:line`, a doc URL, a command and its output) and a verdict per finding.

## Fold

For each finding, change the plan or overrule it:

- Change the plan when the finding cites evidence the plan missed.
- Overrule it when the plan already records the point as a decision with a cited rejection, or the finding contradicts a stated constraint.

Add a line to the Brief stating that the critique ran, listing what it changed and what you overruled with the reason. The critique is done when every finding is either reflected in the plan or named as overruled.
