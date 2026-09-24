---
name: prompting:hill-climb
description: >-
  Hill-climb a skill against its `claude plugin eval` suite: baseline, error
  analysis, one change per candidate, pooled comparison against run-to-run
  noise, and a holdout check. Use when improving a skill with evals, deciding
  whether a skill change helped, or making a suite ready to climb on.
argument-hint: "<skill> [<suite dir>]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Agent
---

# Hill Climb

The goal is a skill that scores higher on its eval suite, where every accepted change carries evidence that it beat run-to-run noise and that the gain holds on cases the climb never tuned against. A change without that evidence stays out, however plausible it reads.

The suite's `README.md` names how to run it and any suite-specific rules. Follow it where it differs from this document.

## Ready the Suite

Check the suite before the first baseline. A climb on an unready suite measures the harness.

- **Split.** Tag every case `dev` or `holdout` in its `case.yaml`. Candidates run on `dev`. `holdout` runs only at the baseline and at the end, so no edit is tuned against it. Aim for about a third of the cases in `holdout`, covering the same surfaces as `dev`.
- **Reach.** A case moves only when the skill fires on it. Add a `tool_used` grader on `Skill` with `input_match` naming the skill: under ablation it reports as an unscored indicator. A case where the skill never fires measures the trigger, and its prompt belongs in a trigger case.
- **Balance.** Include cases where the skill should change little, so a climb that over-applies the skill loses score.
- **Graders.** Grade the output with `regex` wherever a pattern decides it, and keep `llm` graders to one criterion each. Pair each removal grader with a survival grader for the fact that must stay, so deleting everything fails.
- **Isolation.** Stub every external service in the fixture: a bare repo for pushes, pasted text for API bodies, an `append_system_prompt` fallback telling the session what to reply when a network call fails. A run that dies on the network scores the sandbox.
- **Noise.** Run the unchanged suite twice. Compare the two with `compare.ts`. Stars there are noise at that run count, and they set how many runs a candidate needs.

## Loop

#### Baseline

Run the suite on the base commit at least twice and pool the runs. Replicate the baseline as many times as each candidate: a single low baseline draw stars every candidate against it.

#### Error Analysis

Read the failing grader explanations, then the traces behind them (`traces/<case>-<arm>-<n>.jsonl`, whose last `result` line is the reply). Sort each failure into one bucket:

- **Skill.** The output is wrong and the skill caused it or failed to prevent it. A candidate targets these.
- **Grader.** The output meets the intent and the grader failed it, or the reverse. Fix the grader in its own change and re-baseline. Leave graders fixed during a climb, since a grader edit moves the baseline.
- **Reach.** The skill never fired, so the output is the model's default.
- **Floor.** The model cannot do it at this tier. Leave it.

Pick the largest skill bucket as the next target.

#### Candidate

Make one change per candidate, on its own branch off the base. Before running it, write down:

- The hypothesis: which instruction changes and why the traces say it will help.
- The target graders and the direction each should move.
- The guard graders a side effect would hit.

Writing the target first keeps the decision from being fitted to whichever row happened to move.

Run the candidate on the `dev` tag as many times as the baseline.

#### Compare

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/compare.ts --suite <suite> <base1>,<base2> <cand1>,<cand2>
```

Each positional column is one or more `aggregate-result.json` paths joined by commas, pooled into one column. A star marks a cell whose permutation p-value against the first column falls below `--alpha` (0.1). `--markdown` prints the starred rows first. The tables cover case score, reply words from the traces, every grader's pass rate, and with `--suite`, score per tag.

Read the stars in this order:

1. **Without arm.** The candidate cannot touch it. A star there is drift or a lucky draw, and a with-arm star of the same size is no evidence. Add runs to both columns.
2. **Indicators.** A with-arm gain on a case where the skill fired no more often than at baseline did not come from the skill's instructions.
3. **Targets.** Accept only when a target grader is starred in the predicted direction.
4. **Guards.** A starred regression on the with arm blocks the change until it is explained from traces or fixed.

About one row in ten stars by chance at the default alpha. Treat a starred row outside the pre-registered targets and guards as a lead for error analysis. It is not a result.

#### Decide

- **Accept.** Open a PR stacked on the suite whose body states the hypothesis, the target, the starred rows from `compare.ts --markdown`, and links to every run pooled into each column.
- **Reject.** Close the PR with the same evidence, so the null result stays findable. A rejected hypothesis stays rejected until something new in the traces argues for it.

The next candidate branches off the accepted change and re-baselines on it.

#### Holdout

After the last accepted change, run `holdout` on the original base and on the final commit, pooled to the same run count. The climb holds when the holdout score does not fall. A `dev` gain with a flat or falling `holdout` score overfit the `dev` cases: find the instruction that names a `dev` case's specifics and generalize or drop it.

## Stopping

Stop when any of these holds, and say which:

- The `dev` score has no room left above the noise from `Ready the Suite`.
- Three candidates in a row came back null. Add harder cases, then resume.
- Every remaining failure buckets as grader, reach, or floor.

## Running

The suite's `run.sh` or `README.md` gives the local and CI commands. `claude plugin eval` takes `--tag dev`, `--case <glob>`, `--runs <n>`, and `--concurrency <n>`, and writes `aggregate-result.json` plus `traces/` under its output directory. A run costs roughly cases × runs × 2 arms agent sessions plus three judge calls per `llm` grader per run. Price a candidate before launching it.
