# Zsh

Quotes the bash habits that misfire under zsh before the Bash tool runs them, and adds a note to the result after a zsh error. Requires `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

## Contents

- **Mod**: [`hooks/hooks.json`](hooks/hooks.json) loads [`register.ts`](mod/register.ts), the entry point.
  - [`words.ts`](mod/words.ts) splits a command into words with their quoting and source spans.
  - [`rewrite.ts`](mod/rewrite.ts) applies the rewrite rules to unquoted characters only.
  - [`explain.ts`](mod/explain.ts) maps zsh error lines to notes.
  - [`shell.ts`](mod/shell.ts) probes the shell's options at session start.
- **Rewrites**:
  - `flag-glob` quotes `--name=*.ts` values and `find -name` patterns.
  - `equals` quotes words starting with `=`.
  - `url` quotes URLs with `?`, `*` or `[`.
- **Notes**: `glob`, `equals`, `reserved`, `split`, and `bash-syntax`. A repeat within a session gets the short form.
- **Shell detection**: the mod picks the shell from `CLAUDE_CODE_SHELL`, then `$SHELL`, then `zsh` on `PATH`, and probes `nomatch`, `nullglob`, `cshnullglob`, and `equals` with a non-interactive `zsh -c`. The glob options gate `flag-glob` and `url`, and `equals` gates the `equals` rule. Under any other shell the mod is a no-op.
- **Events**: `session.start`, `rewrite`, `explain`, and `error` go to [`mod-events`](../mod-events/README.md).
- **Evals**: [`evals/bash-habits`](evals/bash-habits/) A/Bs the plugin against Bash habits that misfire under zsh. It runs locally only, from a zsh launcher with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

## Tests

`bun scripts/mod-test.ts zsh` runs the mod's tests. Run it outside the sandbox, since it writes to a temp directory.

## Removal

The `mods` query in `observability:session` reads these events from `mod_events`.

- Retire a rewrite rule that appears in no `rewrite` event's `rules` attribute for 30 days.
- Retire a note class with no `explain` events in 30 days.
- Retire the plugin if the Bash tool stops running zsh or runs it under bash emulation.
