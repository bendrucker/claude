# `writing:rewrite` Eval

A native `claude plugin eval` suite for `writing:rewrite`. Each case pastes a short draft (commit message, doc paragraph, PR comment, Slack update) and asks for a rewrite, with and without the plugin.

A rewrite fails in two directions: it drops a functional fact the draft carried, or it lets a trope survive. `keeps-*` graders check that the rewrite keeps each functional fact. `no-*` graders check that no trope survives. `rewrite-block` checks that the reply holds the rewrite between `<rewrite>` and `</rewrite>` lines, and `skill-fired` that the plugin arm invoked `writing:rewrite`.

Every `regex` grader is scoped to the `<rewrite>` block. The reply can then quote what it cut without failing a removal grader. `pr-comment` holds little slop, so it mostly checks that the rewrite keeps what the draft already did well.

Cases are tagged `dev` or `holdout`. Tune against `dev`. Run `holdout` once, after tuning is done.

In CI, `gh workflow run eval.yml --ref <branch> -f suite=plugins/writing/evals/rewrite -f args='--tag dev'` runs it on dispatch, and a pull request carrying the `eval` label runs it when the PR touches the `writing` plugin. `bun evals/native/run.ts plugins/writing/evals/rewrite -- <args>` runs it locally with the Bash sandbox disabled. Results land in the gitignored `results/`.

`bun evals/native/check.ts plugins/writing/evals/rewrite` tests every regex grader against `examples/<case>/`:

- `pass.md`: a reply that should pass every grader
- `unchanged.md`: the draft returned as is
- `empty.md`: an empty block
- `draft.md`: a plausible rewrite seeded with the case's failure mode, or a clean rewrite for `pr-comment`
