# `pull-request:create` Eval

A native `claude plugin eval` suite for `pull-request:create`. It replaces the promptfoo suite under `skills/create/evals/`, which stays until this suite's results are trusted.

Run `plugins/pull-request/evals/create/run.sh` with the Bash sandbox disabled, since the runner cannot start agent runs inside it. Arguments pass through to `claude plugin eval`, for example `--runs 1 --case plan-deviations`. Runs bill the logged-in subscription: the script unsets `ANTHROPIC_API_KEY` before the runner hands its environment to each session.

The runner rejects symlinks in a loaded plugin, so `run.sh` copies `pull-request` and `writing` to a fresh temp root and installs each from its lockfile, the way Claude Code caches a plugin. Each case scaffolds a git repo with `fixture.sh`, asks for a PR, and grades the drafted title and body. The default ablation adds a baseline arm without the plugins, and the `skill-fired`, `skill-loaded`, and `writing-fired` graders only report on the with arm.

Results, including every trace, land in the gitignored `results/<timestamp>/`.

`gh workflow run eval.yml --ref <branch> -f suite=pr-create` runs the suite in CI on the `CLAUDE_CODE_OAUTH_TOKEN` secret, with `-f args='--runs 1 --case plan-deviations'` for a narrower run. The job summary tabulates each case's score with and without the plugins, and `-f baseline=<run id>` appends the `compare.ts` tables against that run. The results directory uploads as an artifact.

`bun compare.ts <baseline>/result.json <candidate>/result.json` prints each grader's pass rate, each case score, and body word counts side by side. At the default `--runs 3`, two runs of the same code routinely moved a grader by 1/3 and a case score by up to 0.19, so a delta counts only when `compare.ts` flags it (a grader moving 2/3 or more, a case score more than 0.2) and the flag repeats against a second candidate run.

