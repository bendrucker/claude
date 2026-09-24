# `writing:no-diary` Eval

A native `claude plugin eval` suite for `writing:no-diary`. Each case pastes an artifact (PR body, code comment, spec, skill section, plan, review comment, issue) and asks for a rewrite in natural language, with and without the plugin.

Every case asks for the rewrite between `<rewrite>` and `</rewrite>` lines, and every `regex` grader is scoped to that block. The skill reports what it cut, often quoting it, so a pattern matched against the whole reply would fail a correct rewrite. Removal graders (`no-*`) are paired with survival graders (`keeps-*`) for the facts that must stay. `pr-light-touch` and `comment-light-touch` hold little or no diary and fail a rewrite that cuts too much.

Cases are tagged `dev` or `holdout`. Tune against `dev` and run `holdout` only to check a finished climb.

`gh workflow run eval.yml --ref <branch> -f suite=plugins/writing/evals/no-diary -f args='--tag dev'` runs it in CI. `run.sh` runs it locally with the Bash sandbox disabled, passing its arguments through to `claude plugin eval`. Results land in the gitignored `results/<timestamp>/`.
