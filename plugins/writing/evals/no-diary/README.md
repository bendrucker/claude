# `writing:no-diary` Eval

A native `claude plugin eval` suite for `writing:no-diary`. Each case pastes an artifact (PR body, code comment, spec, skill section, plan, review comment, issue) or a short draft to polish (commit message, doc paragraph, PR comment, Slack update) and asks for a rewrite in natural language, with and without the plugin.

Every case asks for the rewrite between `<rewrite>` and `</rewrite>` lines, and every `regex` grader is scoped to that block. The skill reports what it cut, often quoting it. A pattern matched against the whole reply would therefore fail a correct rewrite. Removal graders (`no-*`) are paired with survival graders (`keeps-*`) for the facts that must stay. `pr-light-touch`, `comment-light-touch`, and `pr-comment` hold little or no slop and fail a rewrite that cuts too much.

Cases are tagged `dev` or `holdout`. Tune against `dev` and run `holdout` only to check a finished climb.

`gh workflow run eval.yml --ref <branch> -f suite=plugins/writing/evals/no-diary -f args='--tag dev'` runs it in CI. `bun evals/native/run.ts plugins/writing/evals/no-diary -- <args>` runs it locally with the Bash sandbox disabled. [`suite.yaml`](suite.yaml) grants `vale` for the skill's lint step in the cases that allow Bash. Results land in the gitignored `results/`.

`examples/<case>/` holds a reply that should pass, the untouched fixture, and an empty block per case. The draft-polish cases add `draft.md`, a plausible rewrite seeded with the case's failure mode. `bun evals/native/check.ts plugins/writing/evals/no-diary` tests every regex grader against them.
