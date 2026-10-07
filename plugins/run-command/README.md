# Run Command

Fill a reply's `! <command>` suggestions into the shell prompt instead of copying them.

## Contents

- **Mod**: Once you type `!`, [`register.tsx`](mod/register.tsx) offers a reply's `! <command>` lines as a button under the reply and a numbered list above the prompt. A digit or a click fills the command. Commands that only blank lines separate form a block, and each block gets a "run all" entry (`0` for the first) that fills them joined with `&&`, so the run stops at the first failure. A block holding `;`, `#`, or a backgrounding `&` gets none, since chaining would misbehave. It records `list.shown` with the count, `pick` with its source (`digit` or `click`), and `pick.all` with the block's size and source through [`mod-events`](../mod-events). Requires `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

## Tests

`bun scripts/mod-test.ts run-command` runs the mod's UI tests. `bun test plugins/run-command/` runs the property tests of the command parser in [`mod/commands.ts`](mod/commands.ts), which run outside the mod harness so they can use Hegel and a real `bash`.
