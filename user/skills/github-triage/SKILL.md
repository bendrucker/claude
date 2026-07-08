---
name: github-triage
disable-model-invocation: true
description: >-
  Clear Dependabot and bot noise from your GitHub notification inbox: mark settled merged and closed PRs done, merge green dependency PRs in repos you maintain, dismiss low-value ones, and leave only real human threads behind.
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

!`gh api "notifications?all=true&per_page=100" --paginate | jq -r '.[] | [.id, .reason, .subject.type, .repository.full_name, (.subject.url | sub(".*/pulls/";"#") | sub(".*/issues/";"issue#")), .subject.title] | @tsv' | column -t -s $'\t'`

Pass `all=true`. The web and mobile Inbox shows read-but-not-done threads, and the default API call returns only unread ones, so the plain list hides most of the noise a person has already glanced at. See [`references/triage-rules.md`](references/triage-rules.md) for why the REST list can't be made to match the Inbox exactly.

The first column is the thread id. It doubles as the key for marking done. `reason` is why it's in the inbox: `mention` and `comment` almost always mean a human is involved.

## Gather

Resolve your own login once, up front: `gh api user --jq .login`. Several rules compare it against PR authors and repo owners.

Most threads are settled the moment you read them: a merged or closed PR needs no action beyond clearing it. For every `PullRequest` notification still open, resolve the fields that decide its fate. Batch these:

- Author, state, whether it merged: `gh api repos/<r>/pulls/<n> --jq '{author:.user.login, state, merged:(.merged_at!=null)}'`. Any closed or merged PR is settled; skip the rest and mark it done.
- Latest actor, when the PR is your own in your own repo: `gh api <subject.latest_comment_url> --jq '{login:.user.login, type:.user.type}'`. This is who last touched the thread, which decides whether it's your-own-work noise or a real reviewer.
- Merge readiness (open PRs only): `gh pr view <n> --repo <r> --json mergeStateStatus`. `CLEAN` is the only green-light value. It already folds in "checks pass", "no conflict", and "not behind base", so gate on it instead of parsing individual checks.
- Your rights: `gh api repos/<r> --jq .permissions.push`. `true` means you can merge.

`mergeStateStatus` is computed asynchronously and returns `UNKNOWN` for a few seconds after any push. On `UNKNOWN`, re-fetch once before deciding.

## Classify

Apply in order. First match wins. Full matrix and edge cases: [`references/triage-rules.md`](references/triage-rules.md).

- **Closed or merged PR.** Mark done, whatever the author or reason. It's settled. This is the largest category after a repo has been active, since every merge you make and every bump Dependabot lands leaves a read-but-not-done thread behind.
- **Bot or self activity on your own PR.** The PR author is you and the repo owner is you, and the latest actor is a bot (`type` is `Bot`) or you. Mark done. Automation and your own chatter on your own work in your own namespace (Worktrunk, Greptile, CI bots, your own replies) isn't something to read. The exception is a different human as the latest actor: a real review stays.
- **Open human thread.** `reason` is `mention` or `comment`, or the PR author is a person. Leave it. This is the whole point. Your own merged or closed PRs fall under the settled rule above, and bot or self chatter on your own PRs under the rule above that.
- **Open non-Dependabot bot** (e.g. `github-actions[bot]` generated-content PRs). Leave it. These change real content and want your eye.
- **Open Dependabot, `mergeStateStatus == CLEAN`, you have push.** Merge, then mark done.
- **Open Dependabot, not mergeable, low-importance dev or CI tooling.** Mark done, leave the PR open. Low-importance means `deps-dev` bumps of linters, formatters, and build tooling (eslint, prettier, globals, ncc) and routine CI-action bumps (`actions/checkout`, `actions/cache`). Neither a red build nor a pending review on these is worth inbox space.
- **Open Dependabot, not mergeable, runtime or production dependency.** Leave it. A failing or blocked bump on a shipped dependency is a real decision for you to make.

Non-PR notifications: subscribed `Release` threads are noise, mark them done. A `RepositoryAdvisory` is a security notice, leave it.

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

`DELETE` marks a thread **done**, which removes it from the web and mobile Inbox. `PATCH` only marks it read, and it stays in the Inbox. Use `DELETE`. A `204` is success.

Order matters on the merge path. Merging a PR fires a state-change event that can flip its thread back to unread, so mark done *after* the merge, and expect a merged PR to resurface once (see [`references/triage-rules.md`](references/triage-rules.md)). A second run of the whole skill catches those merge-generated threads under the closed-or-merged rule.

## Verify

You cannot confirm a clean Inbox from the REST API. `all=true` keeps returning done threads, and `GET /notifications/threads/<id>` still answers `200` after a `DELETE`, so there is no read-back for done. Trust the `204`s and report against them.

Report what you merged, what you marked done without merging, and the threads you left with a one-line reason each. Count the successful `DELETE`s so the total is concrete. The left-behind list is the actual work for a human. Tell the user to confirm in the app, since that's the only place the done state is observable.
