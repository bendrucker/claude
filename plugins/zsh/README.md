# Zsh

Makes zsh pass an unmatched glob or an `=`word through as written, as bash does, and adds a note to the result after a zsh error.

## Contents

- **Options**: a `SessionStart` hook writes `unsetopt nomatch equals` to `CLAUDE_ENV_FILE`, which the Bash tool sources after its shell snapshot in the main thread and in subagents. `--include=*.ts`, `=====`, and a URL with `?` reach the command unquoted. A glob with no match stays a literal word, so the command runs and the tool reports the missing file, as in bash.
- **Mod**: [`hooks/hooks.json`](hooks/hooks.json) loads [`register.ts`](mod/register.ts), the entry point.
  - [`explain.ts`](mod/explain.ts) maps zsh error lines to notes.
  - [`shell.ts`](mod/shell.ts) detects zsh at session start.
- **Notes**: `glob`, `equals`, `reserved`, `split`, and `bash-syntax`. A repeat within a session gets the short form. `glob` and `equals` fire only when something turned the options back on.
- **Shell detection**: the mod picks the shell from `CLAUDE_CODE_SHELL`, then `$SHELL`, then `zsh` on `PATH`, and reads `$ZSH_VERSION` with a non-interactive `-c`. Under any other shell the mod is a no-op.
- **Events**: `session.start`, `explain`, and `error` go to [`mod-events`](../mod-events/README.md).
- **Evals**: [`evals/bash-habits`](evals/bash-habits/) A/Bs the plugin against Bash habits that misfire under zsh. It runs locally only, from a zsh launcher.

## Tests

`bun scripts/mod-test.ts zsh` runs the mod's tests. Run it outside the sandbox, since it writes to a temp directory.

## Removal

The `mods` query in `observability:session` reads these events from `mod_events`.

- Retire a note class with no `explain` events in 30 days, except `glob` and `equals`, which watch the options hook.
- Revert the options hook if `explain` events of class `glob` or `equals` rise above their rate before it within 30 days.
- Retire the plugin if the Bash tool stops running zsh or runs it under bash emulation.
