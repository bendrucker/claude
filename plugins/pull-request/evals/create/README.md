# `pull-request:create` Eval

A native `claude plugin eval` suite for `pull-request:create`. Each case scaffolds a git repo with `fixture.sh`, asks for a PR, and grades the drafted title and body, with and without the plugins.

`gh workflow run eval.yml --ref <branch> -f suite=plugins/pull-request/evals/create` runs it in CI and reports to an `eval / pull-request-evals-create` check on the branch's head commit. `-f args='--runs 1 --case plan-deviations'` narrows the run, and `-f baseline=<run id>` adds the `compare.ts` tables against an earlier run, flagged rows first.

`compare.ts` flags a grader whose pass rate moves by 2/3 or more and a case score that moves by more than 0.2. At the default `--runs 3`, two runs of the same code moved a grader by 1/3 and a case score by up to 0.19, so a delta counts only when the flag repeats on a second candidate run.

`run.sh` runs the suite locally with the Bash sandbox disabled, passing its arguments through to `claude plugin eval`. Results land in the gitignored `results/<timestamp>/`.
