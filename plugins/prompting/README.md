# Prompting

Writing documents a model executes: product and system prompts, skills, tool and agent descriptions, `CLAUDE.md` and `AGENTS.md`, reference files behind a pointer. Human-consumable prose belongs to the [writing](../writing) plugin instead.

## Contents

- **Skills**: `prompting` doctrine for any document a model executes (placement, pointer wording, completion criteria, leading words, sentence form, pruning), with `references/conversion.md` for rewriting an existing document. `prompting:scan` reports prompt defects and gates on them
- **Scripts**: [`skills/scan/scripts/scan.ts`](skills/scan/scripts/scan.ts), the CLI over the rules in [`skills/scan/scripts/rules.ts`](skills/scan/scripts/rules.ts)

## Testing

```sh
bun test plugins/prompting
```
