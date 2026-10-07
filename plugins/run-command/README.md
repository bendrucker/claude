# Run Command

Fill a reply's `! <command>` suggestions into the shell prompt instead of copying them.

## Contents

- **Mod**: Once you type `!`, [`register.tsx`](mod/register.tsx) offers a reply's `! <command>` lines as a button under the reply and a numbered list above the prompt. A digit or a click fills the command. Commands separated only by blank lines or code fences form a block, and each block of two or more gets a "run all" entry that fills them joined with `&&`, so the run stops at the first failure. `0` fills the first such entry. A block whose commands would misbehave when chained gets no entry, and [`commands.ts`](mod/commands.ts) lists the cases. Picks are recorded through [`mod-events`](../mod-events). Requires `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

## Tests

`bun scripts/mod-test.ts run-command` runs the mod's UI tests. `bun test plugins/run-command/` runs the property tests of the command parser in [`mod/commands.ts`](mod/commands.ts), which run outside the mod harness so they can use Hegel and a real `bash`.
