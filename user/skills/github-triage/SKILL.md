---
name: github-triage
disable-model-invocation: true
description: >-
  Clear Dependabot and bot noise from your GitHub notification inbox: merge green dependency PRs in repos you maintain, dismiss low-value failing ones, and leave only real human threads behind.
argument-hint: "[--dry-run]"
allowed-tools:
  - AskUserQuestion
  - Bash(gh api:*)
  - Bash(gh pr view:*)
  - Bash(gh pr merge:*)
  - Bash(gh repo view:*)
---

# GitHub Triage

Walk the notification inbox, act on the noise, leave the signal. The signal is threads from real humans. The noise is Dependabot and bot PRs that either merge cleanly or aren't worth a look.

Default end state: every clearable notification marked done, and a summary of what stays and why. `--dry-run` classifies and prints the plan without merging or dismissing anything.

## Inbox

!`gh api notifications --paginate | jq -r '.[] | [.id, .reason, .repository.full_name, (.subject.url | sub(".*/pulls/";"#")), .subject.title] | @tsv' | column -t -s $'\t'`

The first column is the thread id. It doubles as the PR-notification key for marking done. `reason` is why it's in the inbox: `mention` and `comment` almost always mean a human is involved.

## Gather

For every `PullRequest` notification, resolve the fields that decide its fate. Batch these:

- Author and state: `gh pr view <n> --repo <r> --json author,state,title,isDraft`
- Merge readiness: same call, add `mergeStateStatus`. `CLEAN` is the only green-light value. It already folds in "checks pass", "no conflict", and "not behind base", so gate on it instead of parsing individual checks.
- Your rights: `gh api repos/<r> --jq .permissions.push`. `true` means you can merge.

`mergeStateStatus` is computed asynchronously and returns `UNKNOWN` for a few seconds after any push. On `UNKNOWN`, re-fetch once before deciding.

## Classify

Apply in order. First match wins. Full matrix and edge cases: [`references/triage-rules.md`](references/triage-rules.md).

- **Human thread.** `reason` is `mention` or `comment`, or the PR author is a person. Leave it. This is the whole point.
- **Non-Dependabot bot** (e.g. `github-actions[bot]` generated-content PRs). Leave it. These change real content and want your eye.
- **Dependabot, `mergeStateStatus == CLEAN`, you have push.** Merge, then mark done.
- **Dependabot, not clean, low-importance dev tooling.** Dismiss the notification, leave the PR open. Low-importance means `deps-dev` bumps of linters, formatters, and build tooling (eslint, prettier, globals, ncc). A red build on these isn't worth your attention.
- **Dependabot, not clean, runtime or production dependency.** Leave it. A failing bump on a shipped dependency is a real signal.
- **Closed or merged PR, stale notification.** Mark done.

When importance is genuinely ambiguous (a `deps-dev` bump of something that ships, a failing prod bump that looks flaky), ask with `AskUserQuestion` rather than guessing. Merges and dismissals are the user's call.

## Act

Skip this section entirely under `--dry-run`; print the classification and stop.

Merge cleanly-green Dependabot PRs:

```
gh pr merge <n> --repo <r> --squash
```

If merge fails with `add the --admin flag`, branch protection is blocking it (required review or status check). **Do not pass `--admin`.** Bypassing branch protection isn't triage. Leave the notification in the inbox and report it as needing a review.

Within one repo, npm dependency bumps that touch `package.json` and the lockfile will conflict after the first merge. The rest go `BEHIND`. Leave them. Dependabot rebases and re-notifies on its own.

Mark a thread done:

```
gh api --method DELETE notifications/threads/<id>
```

`DELETE` marks a thread **done**, which removes it from the inbox UI. `PATCH` only marks it read, and it stays visible. Use `DELETE`. Only mark a merge-path thread done after its merge succeeds.

## Verify

Re-list the inbox and confirm the threads you handled are gone:

```
gh api notifications --paginate | jq 'length'
```

A dismissed thread still returns `200` from `GET /notifications/threads/<id>` (done is not deleted), so don't verify by fetching the thread. Verify by its absence from the list.

Report the count before and after, what was merged, what was dismissed without merging, and the remaining threads with a one-line reason each. The remaining list is the actual work left for a human.
