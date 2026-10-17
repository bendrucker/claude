# `review:peer` Eval

A native `claude plugin eval` suite for `review:peer`, with and without the plugin. It pins the addressing rule in [`tone.md`](../../skills/peer/tone.md): review comments speak to the PR author as "you" or impersonally, never by name or in the third person.

| Case | What it holds |
| --- | --- |
| `author-voice` | A local checkout of a PR by a named author whose `retry` helper returns `fn()` without `await`, so failed deliveries are never retried |

The sandbox has no network, so the case names the author in the prompt and the session reads the diff from git. The case asks for the comments between `<comments>` and `</comments>` lines, and every reply `regex` grader is scoped to that block, since the reply around it may name the author when talking to the reviewer. `catches-await` keeps an empty review from passing the addressing graders. `second-person` judges the pronouns a regex cannot.

`bun evals/native/run.ts plugins/review/evals/peer -- <args>` runs the suite locally with the Bash sandbox disabled. Results land in the gitignored `results/`. `gh workflow run eval.yml --ref <branch> -f suite=plugins/review/evals/peer -f args='--tag dev'` runs it in CI.

`bun evals/native/check.ts plugins/review/evals/peer` tests the regex graders against the replies in [`examples/`](examples/).
