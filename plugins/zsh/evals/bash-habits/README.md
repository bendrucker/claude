# `zsh` Bash-habits Eval

A native `claude plugin eval` suite for the `zsh` plugin. Each case scaffolds a small fixture and checks one Bash habit that misfires under zsh: an unquoted `--include=*.ts` that aborts with `no matches found`, an `echo ===` separator that fails with `== not found`, a glob that matches nothing, and a heredoc body that must reach the file untouched.

| Case | Habit | Graders |
|---|---|---|
| `replay-flag-glob` | `grep -rln … --include=*.ts --include=*.tsx \| …; echo ---; …` | no flag-glob error line, `Counter.tsx` in the reply |
| `replay-equals` | `… && echo === && … && echo ==DOCS=== && ls docs` | no `=` error line, `api.md` in the reply |
| `replay-find` | `find . -name *.yaml …` from a root with no YAML | `dashboard.yaml` in the reply. zsh prints the same error for the model's own `ls *.yaml` probe, which the plugin notes rather than rewrites, so no trace grader |
| `replay-url` | an unquoted URL with `?` | no glob error line, the stripped URL in the reply |
| `pasted-command` | `--include=*.ts` and `echo ===` in one pasted line | no zsh error line, the grep match in the reply |
| `gather-ticket` | the model's own one-pass gather over `.ts`, `.vue`, `.sql`, and `.sh` files | no flag-glob or `=` error line, the status grep printed |
| `gather-brief` | the same gather in two extensions, under a subagent system prompt | no flag-glob or `=` error line, the status grep printed |
| `missing-glob` | `ls config/*.json` with no match | reply states zero JSON and three YAML files |
| `heredoc-untouched` | a `===` or `*.ts` line inside a heredoc | a later `cat` shows the exact body |

`bun evals/native/run.ts plugins/zsh/evals/bash-habits -- --runs 3` runs the suite locally with the Bash sandbox disabled. Set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in the launching environment, because the plugin's hooks are function hooks that load only with it. The runner passes its environment through to `claude plugin eval`, and neither `suite.yaml` nor `case.yaml` can set variables for the session under test. Each case lists the plugin and `mod-events` in `plugins`, paths that resolve from the case directory.

## Reading the arms

The with arm loads the plugin, and the without arm is the bare baseline.

`gather-ticket` and `gather-brief` leave the commands to the model. Their prompts were hill-climbed against the bare baseline until Opus wrote the habit unprompted. Naming literal extensions (`.ts`, `.vue`) and asking for one pass with separators drew a chain of unquoted `--include=*.ext` flags in most runs, while naming languages in words ("TS and Vue") didn't draw it once. `gather-brief` runs under a subagent-style system prompt, where real sessions hit the habit most. In about half the without-arm runs zsh aborts the grep. The with arm never does.

The `replay-*` cases and `pasted-command` hand the model a command shaped like real failures mined from the session index, one per rewrite rule, to run as written. The habit is present in every run, so these cases pin each rule. The without arm hits the zsh error and loses the output after it, unless the model notices and reruns the command quoted.

`missing-glob` and `heredoc-untouched` guard ordinary work. A plain glob that matches nothing is noted rather than rewritten, and a heredoc body must never be quoted.

The trace graders match zsh's `(eval):N:` error prefix rather than the bare message, because a reply that mentions "no matches found" in prose would otherwise fail the case.

## Scope

Eval sessions load function hooks when `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` is set in the launching environment, and their Bash tool runs the launcher's `$SHELL` (or `CLAUDE_CODE_SHELL`), which a case cannot set. The suite therefore measures something only when launched from a zsh machine. CI runners run bash, where the plugin stays inert, so the suite is not wired into `.github/workflows/eval.yml`.
