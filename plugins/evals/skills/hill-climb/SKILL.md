---
name: evals:hill-climb
description: >-
  Hill-climb a skill, agent, rule, or CLAUDE.md against its eval suite. Use
  when changing one to raise an eval score, when building or readying the suite
  a climb runs on, when judging whether a score change beat noise, or when
  testing whether an instruction still earns its tokens.
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

The suite's `README.md` names how to run it and any suite-specific rules. Follow it where it differs from this document. The commands for each operation below depend on the harness: [native.md](references/native.md) for `claude plugin eval`, [harnesses.md](references/harnesses.md) for any other. Use the harness the suite already runs on.

When the target is a prompt an application sends through the Claude API or the Agent SDK, run `/claude-api build-eval` to build its eval and `/claude-api hillclimb` to climb it. Those guides carry the per-model API behavior this document leaves out.

## Ready the Suite

Before the first baseline, check the suite against every item in [references/suite.md](references/suite.md): the frame, case sources, the split, reach, graders, isolation, scaling, noise, and headroom. When the target has no suite yet, build one to the same checks. Re-check it whenever a case or grader changes.

## Loop

Open [references/pr-body.md](references/pr-body.md) before drafting any PR body.

#### Baseline

Run the suite on the base commit at least twice and pool the runs. Replicate the baseline as many times as each candidate: a single low baseline draw stars every candidate against it. Get replicates from separate invocations. Repeats inside one invocation share its drift.

Record the harness version and the model each arm ran on beside the baseline. Re-baseline when either changes mid-climb. Keep a climb log from the first run, per [references/climb-log.md](references/climb-log.md).

#### Error Analysis

Read the failing grader explanations, then the trace and final reply behind each. Sort each failure into one bucket:

- **Skill.** The output is wrong and the skill caused it or failed to prevent it. A candidate targets these. When the rule sits in a reference the sessions never opened, the candidate either inlines it or sharpens the pointer to it. Count the sessions that opened the reference, since injected skill text puts its filename in every trace. When another rule claims the case before the session reaches the target rule, put the fix in the text the session already follows for that case. A session that opened the rule and still hedged it also belongs here: the rule's wording lost to the model's trained default. When several such failures reproduce one outdated form, put a table mapping each old form to its replacement near the top of the body, ahead of the examples it governs.
- **Grader.** The output meets the intent and the grader failed it, or the reverse. A case that never moves while candidates fix its neighbors belongs here until its prompt is shown to state everything its graders check. Fix the grader in its own change, then re-score every stored run and compare the re-scored copies. Only a changed judge or file-target grader needs a re-baseline. Leave graders fixed during a climb, since a grader edit moves the baseline.
- **Reach.** The skill never fired, so the output is the model's default. A description-only candidate targets these. Its target is the skill-fired indicator on the cases that missed, and its guards are the quiet cases and the case scores. Fix skill failures on cases that fire first, since widening reach spreads them.
- **Floor.** The model cannot do it at this tier. Leave it.

Pick the largest skill bucket as the next target.

#### Candidate

Make one change per candidate, on its own branch off the base. Before running it, write down:

- The hypothesis: which instruction changes and why the traces say it will help.
- The target graders and the direction each should move.
- The guard graders a side effect would hit. A change that orders a step ("first X") needs a guard on every case where a different step must come first.

Writing the target first keeps the decision from being fitted to whichever row happened to move.

Write the instruction as the failing behavior in general terms, never with a `dev` case's nouns, phrases, or fixture details. Check every example the change names against the `holdout` fixtures, and swap out any a `holdout` case uses. Size and word the change, and count its tokens, per [references/candidate.md](references/candidate.md).

A removal is a candidate too, judged by whether the score holds rather than rises: follow [references/prune.md](references/prune.md).

#### Screen

Screen each candidate on its target and guard cases before its full run, per [references/screen.md](references/screen.md). A screen sends a candidate to verify or back for revision, and never accepts a change.

#### Verify

Run the candidate on the `dev` tag as many times as the baseline, each replicate its own invocation. Pool the screen's repeats into neither column.

#### Compare

Pool each side's replicates into one column, then compare per case, arm, and grader. A star marks a cell whose two-sided permutation p-value against the base column falls below 0.1. A cell needs at least 4 runs a side to star at that threshold. On a harness other than native, write an adapter for its stored runs before the first comparison, per [harnesses.md](references/harnesses.md), and compare every column through it. A case whose errored runs left the pool is not comparable. Re-run it before reading its row.

Read the stars in this order:

1. **Without arm.** The candidate cannot touch it. A star there is drift or a lucky draw, and a with-arm star of the same size is no evidence. Add runs to both columns, scoped to the cases in doubt. Pooled tag rows then mix unequal run counts per case, so read those cases' own rows. A case with no without arm scores its with-only graders. Check its drift against the with-arm spread between the two baseline replicates instead.
2. **Indicators.** A with-arm gain on a case where the skill fired no more often than at baseline did not come from the skill's instructions.
3. **Targets.** Accept only when a target grader is starred in the predicted direction. When the diff cannot explain the size of a gain, or a judge grader rises while the deterministic graders on the same case stay flat, read five traces before accepting. Leave cases at the ceiling on both arms out of a claimed gain.
4. **Guards.** A starred regression on the with arm blocks the change until it is explained from traces or fixed. When several guards on one case drop together, check the case minimum first: one collapsed run fails every survival grader at once, and its trace shows whether the candidate caused it.

About one row in ten stars by chance at the default alpha. Treat a starred row outside the pre-registered targets and guards as a lead for error analysis. It is not a result.

#### Decide

- **Accept.** Open a PR whose body states the hypothesis, the target, the starred rows, and links to every run pooled into each column. When the harness reports cost, latency, or turns per run, put them beside the pass counts. An efficiency gain carries a change only when it was the pre-registered target. Before opening it, dispatch the review agent: an `Agent` call with `subagent_type: evals:review`, passing the climb log path and every result path pooled into each column, since the agent starts with no context. Resolve every check it marks `fails` or `can't tell`, and put its report in the body.
- **Reject.** Close the PR with the same evidence, so the null result stays findable. When the evidence is borderline, such as a lone star or a guard explained from traces, dispatch `evals:review` the same way first, so a misread doesn't close the hypothesis. A rejected hypothesis stays rejected until something new in the traces argues for it.

The next candidate branches off the accepted change and re-baselines on it. Candidates may run in parallel off one base. When two are accepted, the second re-runs on top of the first before it merges.

#### Stall

After two null candidates in a row, stop editing. Re-read every remaining `dev` failure in the latest traces and bucket each one afresh. Fix grader-bucket failures and ambiguous prompts and re-score before the next candidate, since only skill failures feed it.

#### Holdout

After the last accepted change, run `holdout` on the original base and on the final commit, two replicates a side, each its own invocation, at matched run counts. The climb holds when the final commit's pooled with-arm `holdout` score is no lower than the base's minus the spread between the base's two `holdout` replicates. A fall past that spread fails the climb whether or not it stars. Compare the two and report a gain only where `holdout` stars. Otherwise report the result as a `dev` gain with no demonstrated holdout gain. A `dev` gain with a flat or falling `holdout` score overfit the `dev` cases: find the instruction that names a `dev` case's specifics and generalize or drop it. Before a PR states a holdout gain, dispatch `evals:review` with the holdout columns and resolve what it finds.

## Stopping

Stop when any of these holds, and say which:

- The `dev` score has no room left above the noise from `Ready the Suite`. Prune instead, per [references/prune.md](references/prune.md), or stop.
- A third null candidate followed a `Stall` review. Add harder cases, then resume.
- The budget cannot cover another candidate at the baseline's replicate count. Skip `holdout` when nothing was accepted, since the final commit is the base.
- A `Stall` review buckets every remaining failure as reach or floor.

## Budget

Price each run and plan the climb under its spend cap before the first run, per [references/budget.md](references/budget.md).

A run that hit a session or quota limit is void. Drop it from its column and re-run it. A column with a void run is not comparable until it is refilled.
