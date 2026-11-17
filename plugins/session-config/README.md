# Session Config

Shows the session's model, and its effort when that differs from the default, in the prompt footer.

## Contents

- **Mod**: [`hooks/hooks.json`](hooks/hooks.json) loads [`register.ts`](mod/register.ts), which rewrites the `PromptHint` line

## Mod Setup

The hint line drops `(shift+tab to cycle)` and `← for agents`, matched exactly. Reworded engine text falls through unchanged. The label goes after the live parts that remain, such as `esc to interrupt`: the model family, then the effort level when it is not `high`, as in `opus`, `sonnet`, or `sonnet · low`. Claude Code draws a ` ·` after the permission-mode pill even for an empty hint, and the label fills it.

Effort comes from the last main-loop `turn.step`. The label shows only the model until the first turn. A numeric (token budget) effort adds nothing. The label keeps to one row: at a narrow width the level drops first, then the family. The mod depends on the [`mod-events`](../mod-events) plugin, which records a `session.start` heartbeat and a `config.change` event with the new label.
