# Run Command

Fill a reply's `! <command>` suggestions into the shell prompt instead of copying them.

## Contents

- **Mod**: Once you type `!`, [`register.tsx`](mod/register.tsx) offers a reply's `! <command>` suggestions as buttons and a numbered list, plus a "run all" entry that chains a block of them with `&&`. [`commands.ts`](mod/commands.ts) finds and groups them. Picks are recorded through [`mod-events`](../mod-events).

## Tests

`bun scripts/mod-test.ts run-command` runs the mod's UI tests. `bun test plugins/run-command/` runs the property tests of the command parser in [`mod/commands.ts`](mod/commands.ts), which run outside the mod harness so they can use Hegel and a real `bash`.
