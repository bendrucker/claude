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

Drive a PR to green CI, or to merged with `--merge`, by reacting to a provider watcher's events with fix-and-push. Babysit is done when it calls `TaskStop` after reporting one terminal: green (no flags), merged (`--merge`), or a block it cannot fix unattended.

## Context

- Branch: !`git branch --show-current`
- Remote URL: !`git remote get-url origin`
- Start SHA: !`git rev-parse HEAD`
- Session: `${CLAUDE_SESSION_ID}`

## Workflow

Start the watcher with `github:actions-monitor` for a `github.com` remote, or `gitlab:ci-monitor` for a `gitlab.com` remote. It runs under `Monitor` and emits JSON events, already deduped by `(sha, state)`. Read event fields from that JSON directly, without piping CLI output to an inline interpreter.

Arguments (`$ARGUMENTS`), both flags off by default:

- `$0` (pr-url): the PR as a URL or number. Pass it through to `follow-up` and the merge commands. Default: the PR for the current branch.
- `--reviews`: after the first green, hand off per [`reviews.md`](reviews.md).
- `--merge`: after green, drive to merged per [`merge-mode.md`](merge-mode.md).

On GitHub, a PR with auto-merge already enabled (`gh pr view <pr> --json autoMergeRequest` is non-null) runs as `--merge`, since whoever enabled it approved the merge.

## Bounds

Every wait runs through a watcher, including the post-submit merge wait. The watcher enforces the poll interval and wall clock (`--max-minutes`, default 60). Pass through a user-supplied `--max-minutes`. After `max-time-reached`, report and stop without starting a new watcher. When babysit runs in `/loop`, the loop handles repetition.

The watcher ends with the session. Resume by invoking babysit from a new session.

## Event Handlers

#### status: running

Wait for the next event.

#### status: failing

CI may run on a synthetic merge commit, so each event reports the source branch SHA. When `git rev-parse HEAD` is newer than the event's `sha`, a fix is already pushed: wait for the new run.

The monitor skill has already run the provider's logs agent (`github:logs` or `gitlab:logs`), which gives a summary and a log-file path. Use the summary to judge triviality.

- No run id on the event: the red check is an external status. Report the failing check names from `gh pr checks` or `glab ci status`, then `TaskStop`.
- Same failure on the start SHA's run: pre-existing. Report it, then `TaskStop`.
- Trivial (lint, type, format, lockfile): fix it, reproduce the CI step locally to verify (skip reproducing lockfile-only changes), commit, and push. The watcher picks up the new SHA.
- Non-trivial (logic bugs, design issues, flaky tests, environment-dependent behavior): report the summary and log-file path, then `TaskStop`.

#### status: success

When a `conflicts` or unresolved `mergeable-unknown` event arrived for the current SHA, handle it per [`references/events.md`](references/events.md) first, since green on a conflicting PR is stale.

Summarize the commits pushed this session with `git log <start-sha>..HEAD --oneline`. Then continue to `--reviews` or `--merge` when set. With neither, report the summary and `TaskStop`.

#### other events

For `conflicts`, `mergeable-unknown`, `queued-timeout`, `api-error`, `rate-limited`, `pr-closed`, `merged`, and `max-time-reached`, load [`references/events.md`](references/events.md).
