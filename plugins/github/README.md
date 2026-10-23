# GitHub Plugin

GitHub workflow, Actions monitoring, and rulesets management for Claude Code.

## Contents

- **Skills**:
  - `actions-monitor`: Watch a PR's CI and stream state events; invokes the logs agent on failures
  - `attach`: Attach an image or video to an issue, PR, comment, or review, through `gh --attach` or the user-attachments endpoint it wraps
  - `copilot`: Cross-model review of the current diff through the Copilot CLI. Slash-invocable only, one call by default and three at most, because the Copilot plan is a fixed budget
  - `notifications`: Inbox management (list, filter, mark read/done, unsubscribe)
  - `pr-comments`: Fetch unresolved review comments from a pull request
  - `stack`: Build, publish, and merge native stacked PRs with the `gh stack` extension
- **Agents**:
  - `github-rulesets-manager`: Configure repository rulesets and branch protection
  - `logs`: Extracts relevant lines from failing-job logs (invoked by `actions-monitor`)
- **Hooks**:
  - Intercepts WebFetch for efficient GitHub data access
  - [`runner-queue.ts`](scripts/runner-queue.ts) follows `gh workflow run` with the new run's place in line when it waits on a self-hosted runner, so the model knows why the run has not started and how long to wait before checking. Silent when the job starts at once or runs on a GitHub-hosted runner. Self-timed to `~/.claude/hook-metrics/github-runner-queue.jsonl`

    ```text
    [github/runner-queue] Run 39817210542 is queued for a self-hosted runner labeled actions-sandbox: 0 job(s) ahead, 1 matching job(s) running.
    Holding the runner:
    - session-bench run 39815981118 job "bench" on main, started 8m ago (recent successful runs take ~14m)
    ```
- **Mod**: [`register.ts`](mod/register.ts) watches the current branch's pull request and shows its CI and review state at the end of the prompt footer. The model is told when the PR merges or closes, when it conflicts with its base or needs an update that the base requires, when its branch moves to a commit the local repository lacks, when a check newly fails, and when other people review or comment, in one line per author. A conflict alert points at the `git:conflicts` skill and fires even when the conflict is already there as the PR is first seen.
  - **Bot chatter**: a review bot's own failing check, such as `Greptile Review`, used to reach the model as a CI failure beside that bot's review, and now arrives only as the review. CodeRabbit walkthroughs and "Actions performed" acks, one-line Linear and Jira linkbacks, and a bot's bodiless thread reply stay out too. They are logged, not shown. The `ignore` and `ignoreBody` options mute more.
  - **Whose turn**: the footer used to echo the review decision, and now leads with whom the PR waits on, padded to one width so the glyphs after it hold still: `you`, `agent` while a turn runs, `review`, `merging`, or `ci`. Glyphs with counts follow: failing checks, reviewers waited on, and unresolved threads whose last word is not the session's. Requested changes hold the author's turn until their reviewer is asked again, which a push alone does not do.
  - **Merging**: auto-merge and a merge queue entry show as `merging` with the queue position. Leaving the queue or auto-merge without merging wakes the model, since a merge group's failing checks never reach the PR.
  - **`/pr` pane**: shows what the watcher last read: every check with its outcome, review state, merge state, and when it polled and polls next. Muted chatter sits behind a collapsed row (`m` toggles it).
  - **Polling**: a timer chain used to poll every 1 to 10 minutes forever, and one lost timer ended the watch. A wall-clock ticker now runs an overdue poll on the first tick after a wake, backs off to every two hours while nothing changes, and returns to minutes on a change or a turn. An open PR's unchanged poll is four conditional requests that spend no rate limit.
  - Every decision, send, muted item, turn change, backoff, and late or revived poll is logged to `mod-events`. Needs a signed-in `gh`. Set the `watch` option to false to turn it off

## Testing

```bash
bun test plugins/github
bun scripts/mod-test.ts github
```
