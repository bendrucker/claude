---
name: performance:hill-climb
description: >-
  Use when asked to make software faster or leaner (runtime, startup,
  throughput, memory, bundle size) through repeated measured changes. For
  prompts or skills scored by an eval suite, use prompting:hill-climb.
argument-hint: "<target> [<notes file>]"
---

# Hill Climb

Goal: a program that is measurably better on the metric the user cares about, where every accepted change carries evidence that it beat run-to-run noise, kept behavior identical, and holds on inputs the climb never tuned against. The user stays in the loop at fixed checkpoints and can reconstruct every decision from one notes file.

This skill is the workflow. Load `performance:benchmark` to build the harness and compare arms, and `performance:profile` to find where the time goes. A repo's own benchmark conventions take precedence over the defaults here.

## Arguments

- `<target>`: the program or command to climb. Required.
- `<notes file>`: where the climb log lives. Default: `CLIMB.md` beside the benchmark harness, or `tmp/climb.md` when the repo has no harness directory.

## Frame

Interview the user in rounds with `AskUserQuestion`, one question per open decision, until each item below is settled and none rests on your assumption. Load a `grilling` skill for the interview when one is installed. Settle every item before building anything. Write the answers into the notes file's Rules section ([references/notes.md](references/notes.md) has the template), then confirm the section with the user.

- **Metric.** The number the user cares about, on an exact scenario: the command, its input state, and the machine state. Start from who waits on the result and when: a person running it by hand after a change, a CI job, a scheduled background run. The scenario the user waits through is the one to measure, and it can differ from the run the code handles most often. A scheduled run nobody waits on can take on extra work that speeds the waited-on one. "Wall time of a sync run by hand right after one upstream commit" is a metric. "Make it faster" is not.
- **Ceiling.** The value past which further gains stop mattering to the user. The climb stops there.
- **Fast signal.** A cheaper or lower-noise number that moves with the metric: CPU time, instructions retired, work per tick, bytes. Accept on it only after the baseline shows it tracks the metric.
- **Guard.** What must stay identical: output, final state, exit code. Name the check that proves it.
- **Side effects.** Everything a run touches outside itself: network, remote state, installed files, caches. Decide per item whether to stub it, hold it fixed, or reset it before each run. A run that changes its own input state measures a different scenario each time.
- **Scope.** Which changes are allowed: code, config, dependencies, external tools, public API.
- **Inputs.** Which scenarios are `dev` (tuned against) and which are `holdout` (scored once at the end). Prefer real inputs over synthetic ones for `holdout`.
- **Budget.** How long the climb may run and how the user wants progress between checkpoints.

## Workspace

Under herdr (`HERDR_ENV=1`), keep the climb in one herdr workspace and run the harness, the A/A, and every measurement in its panes, so the user can watch them. On a cloud VM the launcher registers the VM as a herdr machine. Create the workspace there, and drive it with the same pane commands plus `--machine <label>`. Load `herdr:herdr` for the commands.

Send every long run's output through `tee` into a log beside the notes file. `compare.ts run` prints each round's per-arm medians as it goes. Read progress from the log, and pass the latest round to the user at the cadence the Budget set, so an hours-long run never goes quiet.

## Harness

Build the benchmark per `performance:benchmark`, or adopt the project's existing one when it meets that skill's requirements, then audit it before the baseline. A harness built with debug or profiling builds, a warm cache the real scenario never has, or a loaded machine measures the harness. Check each against the Frame's scenario. When runs or resets write many files, check the load for processes that watch the filesystem (backup, indexing, sync clients), and ask the user to exclude the harness directory from them.

Run the program twice from a fresh reset and diff the end states. A difference is state the reset misses or a side effect still reaching outside the harness.

Keep the loop tight: every minute a run or reset costs is paid on each A/A run, candidate, and re-baseline. Reset per run only the state the scenario depends on. Move work that feeds every run identically out of the per-run reset: build fixtures and install toolchains once with `--setup`, and cache downloads and inputs the metric does not cover. Each hoisted step is a contamination risk, so run the end-state diff above after each one. A hoisted step that makes the diff differ, or moves the A/A, goes back into the reset.

Time one run with its `--prepare` reset before launching the A/A, and multiply by the planned run count. When the A/A alone would take a large share of the budget, tighten the reset or cut the run count before starting it.

Record the baseline twice with the unchanged program (an A/A comparison). Its spread is the noise floor, and it sets the run count a candidate needs.

Profile the baseline per `performance:profile` and rank where the time goes.

#### Checkpoint

Show the user the baseline table, the noise floor, the profile's top entries, and a candidate list ranked by the share of the metric each one targets. Wait for the user's review before the first candidate.

## Loop

#### Candidate

Make one change per candidate. Before measuring it, append to the notes file:

- The hypothesis, citing the profile entry it targets.
- The target: which metric moves, and in which direction.
- The guards a side effect would hit.

Writing the target first keeps the decision from being fitted to whichever number happened to move. A candidate without a profile entry behind it ranks last.

#### Measure

Run the guard check first. A candidate that changes behavior is rejected without timing.

Screen with the fast signal or a microbenchmark of the changed path. Confirm a candidate that passes the screen with the full metric, interleaved against the current accepted arm at the baseline's run count.

#### Decide

- **Accept** when the target moves in the predicted direction past the acceptance rule in the notes file (default: permutation p < 0.1 and a median gain of at least 3%) and no guard regresses. Commit the change alone, with the evidence in the commit body.
- **Reject** otherwise. Record the hypothesis, pseudocode of the change, and the numbers in the notes file, and save the diff as a patch beside it, so the null result stays findable. A rejected hypothesis stays rejected until a new profile argues for it.

Re-profile after each accept, since the ranking shifts. After the first decision, report it to the user in one line and continue unless the user redirects.

A harness change mid-climb moves the baseline. Commit it separately, re-run the baseline, and note it in the notes file.

## Stopping

Stop when any of these holds, and say which:

- The metric reached the ceiling.
- Three candidates in a row were rejected.
- The profile's remaining entries are outside the Frame's scope.
- The budget cannot cover another candidate at the baseline's run count.

When an ETA was given, re-estimate it after each decision, counting the validation runs still ahead. Tell the user as soon as the estimate slips.

Then run `holdout` once on the original base and the final commit. The climb holds when no holdout score falls. A `dev` gain with a flat or falling `holdout` overfit the `dev` inputs.

## Report

Finish the notes file's Where It Stands section: base against final on every scenario, starred where significant, and the stop reason. For a PR or a maintainer comment, lead with the metric's before and after in plain words, then a bulleted list of accepted changes with each one's gain. Offer to publish the notes as an artifact when others will read it.
