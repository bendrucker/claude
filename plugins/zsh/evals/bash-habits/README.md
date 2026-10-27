# Bash Habits Eval

A native `claude plugin eval` suite for the `zsh` plugin. Each case scaffolds a small fixture and checks one Bash habit that misfires under zsh.

| Case | Habit | Graders |
|---|---|---|
| `replay-flag-glob` | `grep -rln … --include=*.ts --include=*.tsx \| …; echo ---; …` | no flag-glob error line, `Counter.tsx` in the reply |
| `replay-equals` | `… && echo === && … && echo ==DOCS=== && ls docs` | no `=` error line, `api.md` in the reply |
| `replay-find` | `find . -name *.yaml …` from a root with no top-level YAML | `dashboard.yaml` in the reply (no trace grader) |
| `replay-url` | an unquoted URL with `?` | no glob error line, the stripped URL in the reply |
| `pasted-command` | `--include=*.ts` and `echo ===` in one pasted line | no zsh error line, the grep match in the reply |
| `gather-ticket` | the model's own one-pass gather over `.ts`, `.vue`, `.sql`, and `.sh` files | no flag-glob or `=` error line, the status grep printed |
| `gather-brief` | the same gather in two extensions, under a subagent system prompt | no flag-glob or `=` error line, the status grep printed |
| `replay-probe` | `ls -d` and `grep` over several candidate globs behind `2>/dev/null`, one with no match | no glob error line, the compose `DATABASE_URL` in the reply |
| `gather-config` | the model's own one-pass search of compose, env, and settings files | no glob error line, the compose `DATABASE_URL` in the reply |
| `missing-glob` | `ls config/*.json` with no match | reply states zero JSON and three YAML files |
| `heredoc-untouched` | a `===` or `*.ts` line inside a heredoc | the trace shows the body intact |

`bun evals/native/run.ts plugins/zsh/evals/bash-habits -- --runs 3` runs the suite. Launch it outside Claude Code's sandbox, since it spawns `claude` sessions. Each case lists the plugin and `mod-events` in `plugins`, paths that resolve from the case directory.

`bun evals/native/check.ts plugins/zsh/evals/bash-habits` tests the regex graders against the traces and replies in [`examples/`](examples/): each case has one that passes every grader and one that fails the graders its sidecar names.

## Reading the Arms

The with arm loads the plugin. The without arm doesn't.

`gather-ticket` and `gather-brief` leave the commands to the model. Their prompts name literal extensions (`.ts`, `.vue`) and ask for one pass with separators, which draws a chain of unquoted `--include=*.ext` flags. Naming the languages in words doesn't. `gather-brief` runs under a subagent-style system prompt, where real sessions hit the habit most.

The `replay-*` cases and `pasted-command` hand the model a command shaped like real failures mined from the session index, one per rewrite rule, to run as written. The habit is present in every run. These cases therefore pin each rule. In `replay-find`, the model often probes with `ls *.yaml` first, which zsh rejects with the same error. The plugin notes that glob without rewriting it, so the case grades only the reply.

`replay-probe` and `gather-config` pin `cshnullglob`. The probe names several candidate files at once. Without the option, zsh skips the whole command when any one candidate is missing.

`missing-glob` and `heredoc-untouched` guard ordinary work. The plugin notes a glob that doesn't match any file and leaves heredoc bodies as written.

The trace graders match zsh's `(eval):N:` error prefix. The bare message also appears in replies that discuss it.

## Scope

The Bash tool in eval sessions runs the launcher's `$SHELL` (or `CLAUDE_CODE_SHELL`), which a case cannot set. The suite measures something only when launched from a zsh machine. CI runners run bash, where the plugin is a no-op. The `.local-only` marker therefore keeps the eval workflow from selecting this suite on labeled PRs.
