---
name: prompting:hill-climb
description: >-
  Hill-climb a skill, rule, or prompt against its eval suite. Use when changing
  one to raise an eval score, or judging whether a score change beat noise.
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

Goal: a skill that scores higher on its eval suite, where every accepted change carries evidence that it beat run-to-run noise and that the gain holds on cases the climb never tuned against. A change without that evidence stays out, however plausible it reads.

The suite's `README.md` names how to run it and any suite-specific rules. Follow it where it differs from this document.

## Ready the Suite

Check the suite before the first baseline. A climb on an unready suite measures the harness.

- **Split.** Tag every case `dev` or `holdout` in its `case.yaml`. Candidates run on `dev`. `holdout` runs once, at the end, so no edit is tuned against it, and a climb that reads it again needs fresh `holdout` cases first. Aim for about a third of the cases in `holdout`. Give both splits a case for every kind of request the skill handles, so a `dev` guard catches a rule that bleeds from one kind into another.
- **Reach.** A case moves only when the skill fires on it. Add a `tool_used` grader on `Skill` with `input_match` naming the skill: under ablation it reports as an unscored indicator. A case where the skill never fires scores the model's default. Include cases where the skill should stay quiet, so a trigger change has a guard. The `Skill` indicator never scores, so guard a quiet case with a `trace` regex, `not_contains` on `"skill":"<name>"`. For a skill users invoke by name, simulate the invocation in `append_system_prompt` on every case, since there is no trigger to test.
- **Balance.** Include cases where the skill should change little, so a climb that over-applies the skill loses score.
- **Graders.** Grade the output with `regex` wherever a pattern decides it, and keep `llm` graders to one criterion each, with an example of a passing reply phrased differently from the obvious one, since the judge reads a bare criterion narrowly. Pair each removal grader with a survival grader for the fact that must stay, so deleting everything fails. Where a case invites invention, grade the claim of the likeliest plausible mechanism the fixture lacks, since a reply may rightly name it as ruled out. Test a claim pattern against negated forms ("haven't reproduced it").
- **Trace.** Match a tool call's input by its key and value alone. Key order in the serialized input varies by tool (`Edit` writes `replace_all` before `file_path`), so an anchored pattern can silently match nothing. Match a string value with `(?:[^"\\]|\\.)*`, since commands carry escaped quotes.
- **Scope.** When the reply wraps an artifact in commentary, have `append_system_prompt` ask for the artifact inside `<out>` tags and anchor each regex to that block, or a report that quotes a cut phrase fails its own grader. Scope a positional `llm` grader ("the first sentence") the same way, or tell the judge which part of the reply to read. `<out>(?:(?!</out>)[\s\S])*?PATTERN` finds a pattern inside the block, and `<out>(?:(?!</out>)[\s\S]){N}` holds when the block runs past N characters, a floor under `contains` and a ceiling under `not_contains`. Size N per case, since a case with more moving parts earns a longer on-topic caveat.
- **Isolation.** Stub every external service in the fixture: a bare repo for pushes, pasted text for API bodies, an `append_system_prompt` fallback telling the session what to reply when a network call fails. A run that dies on the network scores the sandbox. A case whose right answer is "no cause found" needs a fixture with no latent cause: have a strong model hunt it before the baseline. A headless session lacks interactive tools such as `EnterPlanMode` and `AskUserQuestion` even when granted. Grade a step that uses one by its observable effect, and tell the session through `append_system_prompt` that nobody answers mid-task.
- **Wrap.** An artifact outside a plugin (a user skill, an agent, a rule or `CLAUDE.md`) loads through the `wrap` key in the suite's `suite.yaml`, which the runner builds into a throwaway plugin. Context files reach the session through a `SessionStart` hook, whatever their `paths:` frontmatter says.
- **Lint.** Run `shellcheck` on the scaffold scripts, and test each regex grader with `bun evals/native/check.ts <suite>` against examples: one that should pass every grader, and one per grader that should fail it. Trace graders need `.jsonl` examples: hand-write them on the model of a smoke run's `tool_use` lines, serialized as compact JSON (`"key":"value"`, as `JSON.stringify` writes it), since trace patterns match that form. Hand-write replies for the `holdout` cases. A fix after the baseline edits a case mid-climb.
- **Noise.** Run the unchanged `dev` cases twice with an explicit `--runs` (the runner defaults to 3), priced first per `Running` at 2 × runs × the per-run cost. Compare the two with `compare.ts`. Stars there are noise at that run count, and they set how many runs a candidate needs. A star takes at least 4 runs a side at the default alpha, and `compare.ts` marks a cell below that `†`, so zero stars at fewer runs says nothing about noise. A case whose without arm swings across its range between noise columns needs more pooled runs than the rest. A grader that fails on both arms in every run is a harness artifact until a trace shows otherwise, such as a `file_exists` glob matching the sandbox's own dotfiles. Scope file globs to what a session would write. A stray `Agent` call can leave a trailing message after the reply, and a `last_message` grader grades that message, so open the trace behind a lone with-arm drop before counting it. `allowed_tools` does not remove `Agent`.
- **Headroom.** A case at 1.00 on both arms in the noise runs discriminates nothing. Harden or replace it until the with arm has room to rise and the without arm sits below it, aiming the new graders at what the without arm's traces still get wrong. Balance cases are exempt. A suite ported from rubric asserts saturates this way.

## Loop

#### Baseline

Run the suite on the base commit at least twice and pool the runs. Replicate the baseline as many times as each candidate: a single low baseline draw stars every candidate against it. Get replicates from separate runs, each a local run or a CI dispatch. `--runs N` in one run shares that run's drift.

#### Error Analysis

Read the failing grader explanations, then the traces behind them (`traces/<case>-<arm>-<n>.jsonl`, whose last `result` line is the reply). Sort each failure into one bucket:

- **Skill.** The output is wrong and the skill caused it or failed to prevent it. A candidate targets these. When the rule sits in a reference the sessions never opened, the candidate either inlines it or sharpens the pointer to it. Count the opens with `bun evals/native/calls.ts <results>... --match <file>`, since injected skill text puts the filename in every trace. When another rule claims the case before the session reaches the target rule, put the fix in the text the session already follows for that case. A session that opened the rule and still hedged it also belongs here: the rule's wording lost to the default.
- **Grader.** The output meets the intent and the grader failed it, or the reverse. Fix the grader in its own change, then re-score every stored run with `bun evals/native/regrade.ts <suite> <results>...` and compare the `-regraded` copies. Only a changed `llm` or file-target grader needs a re-baseline. Leave graders fixed during a climb, since a grader edit moves the baseline.
- **Reach.** The skill never fired, so the output is the model's default. A description-only candidate targets these. Its target is the skill-fired indicator on the cases that missed, and its guards are the quiet cases and the case scores. Fix skill failures on cases that fire first, since widening reach spreads them.
- **Floor.** The model cannot do it at this tier. Leave it.

Pick the largest skill bucket as the next target.

#### Candidate

Make one change per candidate, on its own branch off the base. Before running it, write down:

- The hypothesis: which instruction changes and why the traces say it will help.
- The target graders and the direction each should move.
- The guard graders a side effect would hit. A change that orders a step ("first X") needs a guard on every case where a different step must come first.

Writing the target first keeps the decision from being fitted to whichever row happened to move.

Check every example the change names against the `holdout` fixtures, and swap out any a `holdout` case uses. A gain on that case would then measure the example rather than the rule.

Run the candidate on the `dev` tag as many times as the baseline. When the budget is tight, run one full `dev` replicate for the guards and top up the target cases with scoped `--case` replicates to 4 runs a side. Guards at that count cannot star, so read their case minimums and open the trace behind any drop.

#### Compare

```bash
bun evals/native/compare.ts --suite <suite> <base1>,<base2> <cand1>,<cand2>
```

Each positional column is one or more `aggregate-result.json` paths joined by commas, pooled into one column. A star marks a cell whose permutation p-value against the first column falls below `--alpha` (0.1). `--markdown` prints the starred rows first. `!` marks a case whose errored runs, such as a session limit, left the pool. Re-run that case before reading its row.

Read the stars in this order:

1. **Without arm.** The candidate cannot touch it. A star there is drift or a lucky draw, and a with-arm star of the same size is no evidence. Add runs to both columns, scoped with `--case` to the cases in doubt. Tag rows then pool unequal run counts per case, so read those cases' own rows. A case with `context.history_file` has no without arm and scores its `with-only` graders. Check its drift against the with-arm spread between the two baseline replicates instead.
2. **Indicators.** A with-arm gain on a case where the skill fired no more often than at baseline did not come from the skill's instructions.
3. **Targets.** Accept only when a target grader is starred in the predicted direction.
4. **Guards.** A starred regression on the with arm blocks the change until it is explained from traces or fixed. When several guards on one case drop together, check the case minimum first: one collapsed run fails every survival grader at once, and its trace shows whether the candidate caused it.

About one row in ten stars by chance at the default alpha. Treat a starred row outside the pre-registered targets and guards as a lead for error analysis. It is not a result.

#### Decide

- **Accept.** Open a PR whose body states the hypothesis, the target, the starred rows from `compare.ts --markdown`, and links to every run pooled into each column. Merge the suite before the first candidate PR, so candidates stack on main instead of on the suite branch.
- **Reject.** Close the PR with the same evidence, so the null result stays findable. A rejected hypothesis stays rejected until something new in the traces argues for it.

The next candidate branches off the accepted change and re-baselines on it. Candidates may run in parallel off one base. When two are accepted, the second re-runs on top of the first before it merges.

#### Holdout

After the last accepted change, run `holdout` on the original base and on the final commit, pooled to the same run count. On CI, dispatch the final branch for both, adding `-f ref=<base sha>` for the base side so both read the same cases. The climb holds when the holdout score does not fall. A `dev` gain with a flat or falling `holdout` score overfit the `dev` cases: find the instruction that names a `dev` case's specifics and generalize or drop it.

## Stopping

Stop when any of these holds, and say which:

- The `dev` score has no room left above the noise from `Ready the Suite`.
- Three candidates in a row came back null. Add harder cases, then resume.
- The budget cannot cover another candidate at the baseline's replicate count. Skip `holdout` when nothing was accepted, since the final commit is the base.
- Every remaining failure buckets as reach or floor. Fix grader-bucket failures and regrade first, and resume if a skill failure surfaces.

## Running

`bun evals/native/run.ts <suite> --ref <ref> -- <args>` runs a suite locally against the artifacts as they stand at `<ref>`, with the cases read from the working tree, so the base and every candidate face the same suite. Arguments after `--` go to `claude plugin eval`: `--tag dev`, `--case <glob>`, `--runs <n>`, `--concurrency <n>`. Results land in `<suite>/results/`, with `aggregate-result.json` and `traces/`. Local runs need the Bash sandbox disabled, and a fresh worktree needs `bun install` before `compare.ts` resolves its dependencies.

On CI, `gh workflow run eval.yml --ref <branch> -f suite=<suite> -f args='--tag dev'` runs one replicate. `-f ref=<sha>` tests another commit against the branch's cases, and `-f baseline=<run id>,<run id>` adds the pooled comparison to the job summary. `gh run download <id>` fetches a run's results for pooling locally.

`run.ts` takes `--case` repeatedly and ORs the globs, with braces and character classes, so scope replicates to exactly the cases in doubt. A run costs roughly cases × runs × 2 arms agent sessions, about $0.10 each for Sonnet on a small fixture, plus three judge calls per `llm` grader per run. Price a candidate before launching it. CI and local runs draw on the same subscription quota. When the quota is tight, run one dispatch at a time and cap the session's spend before the first run.

For a suite in another harness, see [references/harnesses.md](references/harnesses.md).
