---
name: pull-request:babysit
description: Monitor a PR's CI, fix trivial failures, and self-cancel when green; --merge drives to merged, --reviews hands off to AI-review triage.
argument-hint: "[pr-url] [--merge] [--reviews]"
effort: low
allowed-tools:
  - Monitor
  - TaskStop
  - Agent
  - Bash(git:*)
  - Bash(bun:*)
  - Bash(bunx:*)
  - Bash(gh:*)
  - Skill(pull-request:follow-up)
  - Skill(github:actions-monitor)
  - Skill(github:stack)
  - Skill(gitlab:ci-monitor)
  - Skill(gitlab:merge-request)
  - Skill(git:conflicts)
  - mcp__github
---

# Babysit PR

Delegate CI monitoring to a provider-specific watcher and react to its events with fix-and-push behavior, stopping when CI turns green.

## Context

- Branch: !`git branch --show-current`
- Remote URL: !`git remote get-url origin`
- Start SHA: !`git rev-parse HEAD`
- Session: `${CLAUDE_SESSION_ID}`

## Workflow

Inspect the remote URL. For a `github.com` remote, invoke the `github:actions-monitor` skill. For a `gitlab.com` remote, invoke the `gitlab:ci-monitor` skill. Each provider skill owns the watcher process (via the `Monitor` tool) and emits a structured JSON event stream describing CI state changes.

Babysit consumes that event stream and reacts with the handlers below. The watcher handles polling, deduping by `(sha, state)`, rate limits, timeouts, and session-scoped lifecycle. Babysit handles fixes, pushes, and reporting. Remember the start SHA above so the success handler can summarize work done in the session.

Parse `$ARGUMENTS` for an optional PR positional and two optional flags, both flags off by default so plain babysit stays CI-only:

- `$0` (pr-url): the PR to babysit, given as a URL or number. Pass it through to `follow-up` and the merge commands below. Default: resolve the PR from the branch in Context.
- `--reviews`: after the first green, triage AI-reviewer threads. See [Reviews Hand-off](#reviews-hand-off).
- `--merge`: don't stop at green; drive the PR to merged. See [Merge Mode](#merge-mode).

## Bounds

Every wait babysit performs runs through a watcher, including the post-submit merge wait ([Merge Mode](#merge-mode)); babysit has no poll loop of its own. The watcher enforces the wall clock (`--max-minutes`, default 60), poll interval, and dedup, so pass `--max-minutes` through when the user supplies one. After a watcher emits `max-time-reached` it has exited: report and stop, never re-arm a fresh watcher. If babysit runs under `/loop`, the loop owns repetition, not babysit.

## Event Handlers

#### status: running

Do nothing. The watcher emits a new status event when the situation changes.

#### status: failing

Compare `git rev-parse HEAD` against the event's `sha`. If HEAD is newer, a fix was already pushed; ignore this event and wait for the new run.

The monitor skill's flow has already invoked the provider's logs agent (`github:logs` or `gitlab:logs`) and produced a summary plus a log-file path. Read the summary to decide triviality.

A failing event carrying no run id has no logs agent behind it: the red check is an external status rather than a CI run. Read the failing check names from the provider's CLI (`gh pr checks`, `glab ci status`), report them, and call `TaskStop`.

Check whether the start SHA's CI run had the same failure. If so, it's pre-existing, not a regression from this branch. Report it and call `TaskStop`.

For trivial failures (lint, type, format, lockfile), attempt a fix. Reproduce the CI step locally to verify (skip reproduction for lockfile-only changes). Commit, push. The watcher picks up the new SHA on its next poll.

For non-trivial failures (logic bugs, design issues, flaky tests, environment-dependent behavior), report the logs agent's summary and log-file path, then call `TaskStop`.

#### status: success

Green on a conflicting PR is stale: if a `conflicts` or unresolved `mergeable-unknown` event arrived for the current SHA, address it per [`references/events.md`](references/events.md) before treating green as done.

Summarize the session: run `git log ${start-sha}..HEAD --oneline` for the commits pushed while babysitting.

Then branch on the `$ARGUMENTS` flags:

- **`--reviews`**: hand off to AI-review triage before finishing. See [Reviews Hand-off](#reviews-hand-off).
- **`--merge`**: don't stop here. Drive the PR to merged. See [Merge Mode](#merge-mode).
- **neither**: report the summary and call `TaskStop`.

#### other events

The watcher also emits `conflicts`, `mergeable-unknown`, `queued-timeout`, `api-error`, `rate-limited`, `pr-closed`, `merged`, and `max-time-reached`. Load [`references/events.md`](references/events.md) for those handlers when one of these arrives.

## Reviews Hand-off

With `--reviews`, after the first green, hand off to `pull-request:follow-up --auto` for AI-reviewer triage, then re-request the human reviewers a push invalidated. Load [`reviews.md`](reviews.md) for the hand-off contract and the re-request commands.

## Merge Mode

With `--merge`, don't stop at green; drive the PR to **merged**. Load [`merge-mode.md`](merge-mode.md) for the merge-submission paths, the re-arm-after-every-push rule, and the oscillation guard.

## Gotchas

The monitor script delivers structured JSON events. Do not pipe CLI output to `python3 -c`, `bun -e`, `node -e`, or any inline interpreter for parsing.

CI may run on synthetic merge commits whose SHA never matches the branch tip. The watcher reports the source branch SHA in each event. Compare against `git rev-parse HEAD`: a failing event for an older SHA is stale (a fix was already pushed) and should be ignored.

Babysit is session-scoped. If the session ends, the watcher process ends with it. Re-invoke this skill from a new session to resume.
