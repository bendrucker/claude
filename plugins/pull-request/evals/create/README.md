# `pull-request:create` Eval

A native `claude plugin eval` suite for `pull-request:create`. Each case scaffolds a git repo with `fixture.sh`, asks for a PR, and grades the drafted title and body, with and without the plugins.

`gh workflow run eval.yml --ref <branch> -f suite=plugins/pull-request/evals/create` runs it in CI and reports to an `eval / pull-request-evals-create` check on the branch's head commit. `-f args='--runs 1 --case plan-deviations'` narrows the run, `-f ref=<ref>` reads the plugins at another ref against this branch's cases, and `-f baseline=<run id>,<run id>` adds [`compare.ts`](../../../../evals/native/compare.ts) tables against the pooled baseline runs, flagged rows first.

`compare.ts` marks a row whose runs differ from the baseline at p < 0.1 under a permutation test. Two runs of the same code star about one row in ten, so replicate the baseline as many times as the candidate and read a star on the without arm as drift.

`bun evals/native/run.ts plugins/pull-request/evals/create -- <args>` runs the suite locally with the Bash sandbox disabled, passing arguments after `--` through to `claude plugin eval`. [`suite.yaml`](suite.yaml) names the gated tools the cases need. Results land in the gitignored `results/<timestamp>/`.
