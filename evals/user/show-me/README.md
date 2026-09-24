# `show-me` Eval

A native `claude plugin eval` suite for the `show-me` user skill, wrapped into a throwaway plugin through [`suite.yaml`](suite.yaml). Each case scaffolds a small TypeScript project with `fixture.sh`, asks in plain language to be shown something about it, and grades the reply with regexes over its code blocks, with and without the skill.

The cases cover each text format the skill names (call tree, component tree, file tree, pseudocode, diff, types first for a design, Mermaid across processes) plus lookups where one small block is the right answer. Each case's system prompt says the user invoked `show-me`, standing in for the slash command a person types, so the suite measures the skill body rather than its trigger. The Artifact format is out of scope, since the eval session has no Artifact tool. `dev` cases drive a climb and `holdout` cases run once at the end.

A grader that looks inside a code block anchors to the opening fence. `^```` alone also matches a closing fence and runs on into the prose after it, so a grader like `declined-card/only-decline-path` skips whole fence pairs from the start of the reply before matching.

[`examples/`](examples/) holds replies each regex grader must pass or fail. `bun evals/native/check.ts evals/user/show-me` checks them after a grader edit.

`gh workflow run eval.yml --ref <branch> -f suite=evals/user/show-me -f args='--tag dev --runs 2'` runs one replicate in CI. `bun evals/native/run.ts evals/user/show-me -- --tag dev` runs it locally with the Bash sandbox disabled. Results land in the gitignored `results/<timestamp>/`.
