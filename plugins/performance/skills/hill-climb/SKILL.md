---
name: performance:hill-climb
description: >-
  Use when asked to make software faster or leaner (runtime, startup,
  throughput, memory, bundle size) through repeated measured changes. For
  prompts or skills scored by an eval suite, use evals:hill-climb.
argument-hint: "<target> [<notes file>]"
---

# Hill Climb

Goal: a program that is measurably better on the metric the user cares about, where every accepted change carries evidence that it beat run-to-run noise, kept behavior identical, and holds on inputs the climb never tuned against. The user stays in the loop at fixed checkpoints and can reconstruct every decision from one notes file.

This skill is the workflow. Load `performance:benchmark` to build the harness and compare arms, and `performance:profile` to find where the time goes. A repo's own benchmark conventions take precedence over the defaults here.

## Arguments

- `<target>`: the program or command to climb. Required.
- `<notes file>`: where the climb log lives. Default: `CLIMB.md` beside the benchmark harness, or `tmp/climb.md` when the repo has no harness directory.

## Frame

Interview the user until each item below is settled and none rests on your assumption:

- Ask in rounds with `AskUserQuestion`, one question per open decision. Load a `grilling` skill when one is installed.
- Settle every item before building anything.
- Write the answers into the notes file's Rules section ([references/notes.md](references/notes.md) has the template), then confirm the section with the user.
- A dispatching brief settles only the items it states. Ask the rest.
- When the user does not answer, send a push notification and continue. Record each unanswered item in Rules as `assumed: <value>`, and name every assumed item in the first decision report.

- **Metric.** The number the user cares about, on an exact scenario: the command, its input state, and the machine state. "Wall time of a sync run by hand right after one upstream commit" is a metric. "Make it faster" is not.
  - Start from who waits on the result and when: a person after a change, a CI job, a scheduled run. Measure the run the user waits through, even when the code handles another run more often.
  - A scheduled run nobody waits on can take on work that speeds the waited-on one.
  - Ask where the real workload spends its time. A benchmark input can skip the phase users wait through.
- **Ceiling.** The value past which further gains stop mattering to the user. The climb stops there.
- **Fast signal.** A cheaper or lower-noise number that moves with the metric: CPU time, instructions retired, work per tick, bytes. Accept on it only after the baseline shows it tracks the metric.
- **Guard.** What must stay identical: output, final state, exit code. Name the check that proves it.
  - When a candidate can change lookup order (`PATH`, module or library search paths), the guard compares what each name resolves to.
  - Only the user relaxes a guard.
- **Side effects.** Everything a run touches outside itself: network, remote state, installed files, caches. Decide per item whether to stub it, hold it fixed, or reset it before each run.
- **Scope.** Which changes are allowed: code, config, dependencies, external tools, public API. Ask whether parallelism is in scope. When caching is in scope, ask where a cache may live and how it invalidates.
- **Inputs.** Which scenarios are `dev` (tuned against) and which are `holdout` (scored once at the end). Prefer real inputs over synthetic ones for `holdout`.
- **Budget.** How long the climb may run and how the user wants progress between checkpoints.

## Workspace

- **herdr.** Under `HERDR_ENV=1`, run the whole climb in one herdr workspace so the user can watch every run. On a cloud VM, create it on the VM's herdr machine and add `--machine <label>` to the same commands. Load `herdr:herdr` for them.
- **Progress.** `tee` every long run into a log beside the notes file. `compare.ts run` prints each round's per-arm medians. Relay the latest round to the user at the cadence the Budget set.

## Harness

Build the benchmark per `performance:benchmark`, or adopt the project's own when it meets that skill's requirements. When the metric is a CI run, read [references/ci.md](references/ci.md). Then, before the baseline:

- **Audit.** Check the harness against the Frame's scenario:
  - It runs to the end point the user waits for. A shell benchmark that exits before the first prompt skips everything deferred to it.
  - It runs the build users run, from a cache no warmer than the scenario's.
- **Watchers.** When runs or resets write many files, look for processes watching the filesystem (backup, indexing, sync clients). Ask the user to exclude the harness directory.
- **Isolation.** Run the program twice from a fresh reset and diff the end states. A difference is state the reset misses or a side effect leaking out.
- **Tight loop.** Each run's cost repeats across every A/A, candidate, and re-baseline.
  - Reset per run only the state the scenario depends on.
  - Hoist work that feeds every run identically into `--setup`: fixture builds, toolchain installs, downloads and inputs the metric does not cover.
  - Repeat the end-state diff after each hoist. Return a step to the reset when the diff or the A/A shifts.
- **Cost.** Time one run with its reset and multiply by the A/A's run count. When that takes a large share of the budget, tighten the reset or cut runs first.
- **Baseline.** Record the unchanged program twice (an A/A comparison). Its spread is the noise floor and sets the run count a candidate needs.
- **Profile.** Profile the baseline per `performance:profile` and rank where the time goes.
  - Size runner and config options (parallelism, caching flags) too, so the candidate list ranks them beside code changes.
  - Confirm the program reads a config option before measuring it. Some tools ignore an unknown key without a warning.

#### Checkpoint

Show the user the baseline table, the noise floor, the profile's top entries, a candidate list ranked by the share of the metric each one targets, and the Set Aside leads. Wait for the user's review before the first candidate.

When the user does not answer, write the checkpoint into the notes file and continue.

## Loop

#### Candidate

Make one change per candidate. Before measuring it, append to the notes file, so the decision cannot be fitted to whichever number happened to move:

- The hypothesis, citing the profile entry it targets.
- The target: which metric moves, and in which direction.
- The guards a side effect would hit.

Write the change for the workload, never for a `dev` input's specifics (its sizes, paths, or contents). A fast path keyed on the fixture passes `dev` and loses on `holdout`.

A candidate without a profile entry behind it ranks last, unless a measurement sizes the time it targets: the gap between wall and CPU time, or a cold run against the warm one profiled. Rank that candidate at its measured size.

Pass the same hypothesis to `compare.ts run --hypothesis`, which stores it with the comparison's load record.

Record every lead you do not climb in the notes file's Set Aside table with its reason. Drop a lead the user put in scope only after asking.

#### Measure

Run the guard check first. A candidate that changes behavior is rejected without timing.

Screen with the fast signal or a microbenchmark of the changed path. Confirm a candidate that passes the screen with the full metric, interleaved against the current accepted arm at the baseline's run count.

#### Decide

- **Accept** when the target moves in the predicted direction past the acceptance rule in the notes file (default: permutation p < 0.1 and a median gain of at least 3%) and no guard regresses. Commit the change alone, with the evidence in the commit body.
- **Keep unconfirmed** when the target did not move but the user agrees to keep the change for a reason outside the metric. Label it "kept, unconfirmed" in the notes, commit body, and PR, and leave it out of the reported gain.
- **Reject** otherwise. Record the hypothesis, pseudocode of the change, and the numbers in the notes file, and save the diff as a patch beside it, so the null result stays findable. A rejected hypothesis stays rejected until a new profile argues for it.
- **Re-run** an accept that rests on rounds `compare.ts report` flags for load, and decide on the re-run. An accept rests on them when the gain or its significance fails without those rounds.
- **Bound** an accepted gain by its target's time in the profile. Re-measure a gain past that bound before committing, or report the excess as unexplained.

After each decision:

- Re-profile after an accept, since the ranking shifts.
- Report the first decision to the user in one line, and continue unless the user redirects.
- Commit a mid-climb harness change separately, re-run the baseline, and note it in the notes file.
- After two rejections in a row, re-run the A/A and re-profile before the next candidate. A stall often means the noise floor rose or the profile ranks work the scenario does not wait on.

## Stopping

Stop when any of these holds, and say which:

- The metric reached the ceiling.
- A third candidate in a row was rejected after that A/A and re-profile.
- The profile's remaining entries are outside the Frame's scope.
- The budget cannot cover another candidate at the baseline's run count while leaving time for the holdout and the report.

When an ETA was given, re-estimate it after each decision, counting the validation runs still ahead. Tell the user as soon as the estimate slips.

Then run `holdout` once on the original base and the final commit. The climb holds when no holdout case is significantly worse. Report every holdout case whose median rose, with its p, as a slip. A `dev` gain with a flat or falling `holdout` overfit the `dev` inputs.

## Report

- **Notes.** Finish the Where It Stands section: base against final on every scenario, starred where significant, and the stop reason.
- **PR or maintainer comment.** Lead with the metric's before and after in plain words, naming the base commit measured against. Then list the accepted changes with each one's gain. Put one metric per table column.
- **External repo.** On a repo the user does not own, ship the code changes alone. Add the harness or notes only when the user asks. Summarize each rejected candidate in a few lines, without links to files that do not ship.
- **Artifact.** Offer to publish the notes when others will read them.
