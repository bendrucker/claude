# Run Command

Fill a reply's `! <command>` suggestions into the shell prompt instead of copying them.

## Contents

- **Mod**: Once you type `!`, [`register.tsx`](mod/register.tsx) offers a reply's `! <command>` lines as a button under the reply and a numbered list above the prompt. A digit or a click fills the command. Requires `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

## Tests

`bun scripts/mod-test.ts run-command` runs the mod's tests.
