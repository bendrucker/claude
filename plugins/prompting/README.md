# Prompting

Writing documents a model executes: product and system prompts, skills, tool and agent descriptions, `CLAUDE.md` and `AGENTS.md`, reference files behind a pointer. Human-consumable prose belongs to the [writing](../writing) plugin instead.

## Contents

- **Skills**:
  - `prompting`: doctrine for any document a model executes, with `references/conversion.md` for rewriting an existing one
  - `prompting:scan`: lints with the `Prompting` Vale style (`WeakModality`, `VagueCriterion`, `NoOp`, `StaleMeasurement`, `TicketRef`) and exits non-zero on an error-level alert
  - `prompting:audit`: runs a judge-driven prune round whose verdicts become telemetry and precision labels

## Setup

`prompt-scan-edit` writes under `.claude/skills`, which the sandbox denies, so add `prompt-scan-edit:*` to `sandbox.excludedCommands`.

Climbing a prompt against its eval suite belongs to the [evals](../evals) plugin's `evals:hill-climb`.

Claude API application prompts belong to the bundled `claude-api` skill: `build-eval`, `hillclimb`, and `prompt-audit`.

## Evals

`evals/rule-precision` scores the scan's Vale checks against commits where a human deleted prose, and scores a candidate rule before it ships.

## Testing

```sh
bun test plugins/prompting
```
