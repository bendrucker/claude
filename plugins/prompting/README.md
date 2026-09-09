# Prompting

Writing documents a model executes: product and system prompts, skills, tool and agent descriptions, `CLAUDE.md` and `AGENTS.md`, reference files behind a pointer. Human-consumable prose belongs to the [writing](../writing) plugin instead.

## Contents

- **Skills**:
  - `prompting`: doctrine for any document a model executes, with `references/conversion.md` for rewriting an existing one
  - `prompting:scan`: reports weak modality, vague completion criteria, and no-op instructions, and exits non-zero on any finding

## Testing

```sh
bun test plugins/prompting
```
