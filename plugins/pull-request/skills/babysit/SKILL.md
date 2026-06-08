---
name: pull-request:babysit
description: |
  Monitor a PR's CI, fix trivial failures (lint, types, formatting), and self-cancel when green. Use after pushing for hands-off CI monitoring. With --merge, drive the PR to merged (handling merge-train/queue kickouts, rebase issues, and re-runs); with --reviews, hand off to AI-review triage after the first green.
argument-hint: "[--merge] [--reviews]"
allowed-tools:
  - Monitor
  - TaskStop
  - Agent
  - Bash(git:*)
  - Bash(bun:*)
  - Bash(bunx:*)
  - Bash(gh:*)
  - Skill(pull-request:follow-up)
  - Skill(gitlab:merge-request)
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

Babysit consumes that event stream and reacts with the handlers below. The watcher handles polling, deduping by `(sha, state)`, rate limits, timeouts, and session-scoped lifecycle. Babysit handles fixes, pushes, and reporting. Remember the start SHA captured above so the success handler can summarize work done during the session.

Parse `$ARGUMENTS` for two optional flags, both off by default so plain babysit stays CI-only:

- `--reviews`: after the first green, triage AI-reviewer threads. See [Reviews Hand-off](#reviews-hand-off).
- `--merge`: don't stop at green; drive the PR to merged. See [Merge Mode](#merge-mode).

## Event Handlers

#### status: running

Do nothing. The watcher emits a new status event when the situation changes.

#### status: failing

Compare `git rev-parse HEAD` against the event's `sha`. If HEAD is newer, a fix was already pushed; ignore this event and wait for the new run.

The monitor skill's flow has already invoked the provider's logs agent (`github:logs` or `gitlab:logs`) and produced a summary plus a log-file path. Read the summary to decide triviality.

Check whether the start SHA's CI run had the same failure. If so, the failure is pre-existing, not a regression from this branch. Report it and call `TaskStop`.

For trivial failures (lint, type, format, lockfile), attempt a fix. Reproduce the CI step locally to verify (skip reproduction for lockfile-only changes). Commit, push. The watcher picks up the new SHA on its next poll.

For non-trivial failures (logic bugs, design issues, flaky tests, environment-dependent behavior), report the logs agent's summary and log-file path, then call `TaskStop`.

#### status: success

Summarize the session: run `git log ${start-sha}..HEAD --oneline` for the commits pushed while babysitting.

Then branch on the flags parsed from `$ARGUMENTS`:

- **`--reviews`**: hand off to AI-review triage before finishing. See [Reviews Hand-off](#reviews-hand-off).
- **`--merge`**: don't stop here. Drive the PR to merged. See [Merge Mode](#merge-mode).
- **neither**: report the summary and call `TaskStop`.

#### conflicts

Reproduce the conflict locally to identify which files conflict:

```
git merge origin/<base> --no-commit --no-ff
git diff --name-only --diff-filter=U
git merge --abort
```

If the conflicting paths are only lockfiles (`bun.lock`, etc.) or generated files, regenerate per project convention (e.g. `rm bun.lock && bun install`), commit the result, and push. The watcher picks up the new SHA.

Otherwise, report the conflicting file list and call `TaskStop`. Do not invoke `gh` or `glab` here; git alone is enough.

#### queued-timeout

Report the event (include `minutes`) and wait. The watcher continues polling.

#### api-error

Report the event (include `consecutive`). If consecutive errors continue past a second threshold event, call `TaskStop`.

#### rate-limited

Report `retry_after` and wait. The watcher resumes polling once the window elapses.

#### pr-closed

Report and stop. The watcher has already exited.

#### max-time-reached

Report the event (include `minutes`) and stop. The watcher has already exited.

## Reviews Hand-off

With `--reviews`, after the first green invoke `pull-request:follow-up --auto <pr-url>` to triage AI-reviewer threads (fix, reply, resolve, looping until the reviewer is satisfied). follow-up calls back into babysit for each post-push CI wait, so let it own the review loop. When it returns:

- If `--merge` is also set, proceed to [Merge Mode](#merge-mode).
- Otherwise report what was addressed and call `TaskStop`.

Human review threads are out of scope here: follow-up lists them and leaves them for you.

## Merge Mode

With `--merge`, don't stop at green; drive the PR to **merged**. CI green is the entry condition; from here, submit to the repo's merge mechanism and recover from kickouts until it lands. GitHub merges run through `gh` directly; delegate all GitLab merge behavior (trains, endpoint, squash) to the `gitlab:merge-request` skill.

First confirm the PR can merge on its own. Don't bypass blocks you can't resolve: missing **human** approval (you can't self-approve; if a bot was the blocker and `--reviews` ran, it's already handled), branch protection, draft state, or requested changes. Report and `TaskStop`. Read state via `gh pr view --json mergeable,mergeStateStatus,reviewDecision,state` (GitLab: `gitlab:merge-request`).

Submit by the most automated path the repo allows (merge queue/train, else auto-merge, else direct, valid since CI is green):

- **GitHub**: `gh pr merge <pr-url> --auto --squash` enables auto-merge or queues the PR. If `--auto` is rejected, merge directly: `gh pr merge <pr-url> --squash`. Prefer squash → merge → rebase per `gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`.
- **GitLab**: delegate to the `gitlab:merge-request` skill.

Then poll until it merges or is kicked out. On a kickout, diagnose and re-submit: a rebase/merge conflict routes through the [conflicts](#conflicts) handler, a CI failure through [status: failing](#status-failing) (each produces a new SHA). Stop on: merged (success); 3 submit attempts (re-submits included, an oscillation guard); an unrecoverable block (missing human approval, non-trivial CI failure, non-lockfile conflict, permissions); or PR closed.

## Gotchas

The monitor script delivers structured JSON events. Do not pipe CLI output to `python3 -c`, `bun -e`, `node -e`, or any inline interpreter for parsing.

CI may run on synthetic merge commits whose SHA never matches the branch tip. The watcher already reports the source branch SHA in each event; compare against `git rev-parse HEAD`.

The Bash tool escapes `!` to `\!`. Use `| not` in jq filters (e.g. `select(.x == null | not)`), or pass filters via heredoc.

The watcher dedupes by `(sha, state)`. A `failing` event for a SHA older than `git rev-parse HEAD` means a fix was already pushed; ignore it.

Babysit is session-scoped. If the session ends, the watcher process ends with it. Re-invoke this skill from a new session to resume monitoring.
