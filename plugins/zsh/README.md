# Zsh

Quotes the bash habits that misfire under zsh before the Bash tool runs them, and adds a note to the result after a zsh error. Requires `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

## Contents

- **Mod**: [`register.ts`](mod/register.ts) rewrites `Bash` commands and explains zsh errors in the result.
  - [`words.ts`](mod/words.ts) splits a command into words with their quoting and source spans.
  - [`rewrite.ts`](mod/rewrite.ts) applies the rewrite rules to unquoted characters only.
  - [`explain.ts`](mod/explain.ts) maps zsh error lines to notes.
  - [`shell.ts`](mod/shell.ts) reads the Bash tool's zsh options at session start.
- **Rewrites**: `flag-glob` quotes `--name=*.ts` style values and `find -name` patterns, `equals` quotes words starting with `=`, and `url` quotes URLs with `?`, `*` or `[`.
- **Notes**: `glob`, `equals`, `reserved`, `split`, and `bash-syntax` explain zsh errors in the result.
- **Shell detection**: the mod reads `nomatch`, `nullglob`, `cshnullglob`, and `equals` at session start. It stays inert when the Bash tool's shell is not zsh.
- **Events**: `session.start`, `rewrite`, `explain`, and `error` go to [`mod-events`](../mod-events/README.md).
- **Evals**: [`evals/bash-habits`](evals/bash-habits/) runs the habits the model reaches for on its own.

## Tests

`bun scripts/mod-test.ts zsh` runs the mod's tests. It writes under `/tmp`, so it runs outside the sandbox.

## Removal

- Retire a rewrite rule that has no `rewrite` events in 30 days.
- Retire the plugin if the Bash tool stops running zsh or runs it under bash emulation.
