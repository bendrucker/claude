# Native `claude plugin eval`

Commands for a suite run by `claude plugin eval` through this repo's `evals/native/` scripts.

## Authoring

- Write each case as `<case>/case.yaml`. The runner, `check.ts`, and CI find cases by that file.
- A suite testing skills, agents, or context files outside a plugin wraps them through `suite.yaml`, because the runner ignores a `CLAUDE.md` or `.claude/rules` in the case's working directory.
- A session reads only inside its working directory, so it cannot open the files a skill links, even in the plugin under test. A copy scaffolded into the working directory reaches the without arm too.
- Put graders shared across cases in the suite's `graders/` and select them by glob.
- Test every regex grader against `examples/<case>/` replies with `bun evals/native/check.ts <suite>`.
- Add a `.local-only` file to a suite CI must skip.
- Keep text mined from real sessions or work repos in the private eval bucket, never in the repo.

## Running

`bun evals/native/run.ts <suite> --ref <ref> -- <args>` runs a suite locally against the artifacts as they stand at `<ref>`, with the cases read from the working tree, so the base and every candidate face the same suite. Arguments after `--` go to `claude plugin eval`: `--tag dev`, `--case <glob>`, `--runs <n>`, `--concurrency <n>`, `--max-cost-usd <usd>`. Results land in `<suite>/results/`, with `aggregate-result.json` and `traces/<case>-<arm>-<n>.jsonl`, whose last `result` line is the reply. Local runs need the Bash sandbox disabled, and a fresh worktree needs `bun install` before `compare.ts` resolves its dependencies.

On CI, `gh workflow run eval.yml --ref <branch> -f suite=<suite> -f args='--tag dev'` runs one replicate. `-f ref=<sha>` tests another commit against the branch's cases, and `-f baseline=<run id>,<run id>` adds the pooled comparison to the job summary. `gh run download <id>` fetches a run's results for pooling locally. For a `holdout` pair, dispatch the final branch for both sides, adding `-f ref=<base sha>` for the base, so both read the same cases.

`run.ts` takes `--case` repeatedly and ORs the globs, with braces and character classes, so scope replicates to exactly the cases in doubt. A run costs roughly cases × runs × 2 arms agent sessions, about $0.05–0.10 each for Sonnet on a small fixture, plus three judge calls per `llm` grader per run. `--ablation none` drops the without arm and halves the cost. A screen is one such run per side, launched together: `--case` for each target and guard, `--runs 16 --concurrency 8 --ablation none`, and a distinct `--label` for each side.

## Comparing

```bash
bun evals/native/compare.ts --suite <suite> --markdown <base1>,<base2> <cand1>,<cand2>
```

Each positional column is one or more `aggregate-result.json` paths joined by commas, pooled into one column. `--alpha` sets the star threshold (0.1). `--markdown` prints the starred rows first.

## Other Operations

- Count the sessions that opened a reference: `bun evals/native/calls.ts <results>... --match <file>`. Injected skill text puts the filename in every trace, so a plain search over traces matches every session.
- Re-score stored runs after a grader fix: `bun evals/native/regrade.ts <suite> <results>...`, then compare the `-regraded` copies.
