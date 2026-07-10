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

Clear bot and Dependabot noise from the notification inbox, leave threads from real humans. `--dry-run` classifies and prints the plan without acting.

## Inbox

!`gh api "notifications?all=true&per_page=100" --paginate | jq -r '.[] | [.id, .reason, .subject.type, .repository.full_name, (.subject.url | sub(".*/pulls/";"#") | sub(".*/issues/";"issue#")), .subject.title] | @tsv' | column -t -s $'\t'`

Triage against `all=true`. The default call returns only unread; the app Inbox also shows read-but-not-done threads, where most stale noise sits. First column is the thread id, which is also the mark-done key.

## Gather

Resolve your own login once: `gh api user --jq .login`. For each open `PullRequest` thread:

- `gh api repos/<r>/pulls/<n> --jq '{author:.user.login, state, merged:(.merged_at!=null)}'`. Any closed/merged PR is settled: mark done, skip the rest.
- `gh pr view <n> --repo <r> --json mergeStateStatus`. Merge gate, per the table below. It computes async, so re-fetch once on `UNKNOWN`.
- `gh api repos/<r> --jq .permissions.push`. `true` means you can merge.
- Latest actor, only for a your-own-PR-in-your-own-repo thread: `gh api <subject.latest_comment_url> --jq '{login:.user.login, type:.user.type}'`.

| `mergeStateStatus` | Meaning | Action |
| --- | --- | --- |
| `CLEAN` | green, no conflict, current | mergeable |
| `BLOCKED` | needs review or a required check | leave, never force |
| `BEHIND` | base moved | leave, Dependabot rebases |
| `UNSTABLE` / `DIRTY` | check failed or conflict | classify by importance |
| `UNKNOWN` | not computed | re-fetch once |

## Classify

First match wins.

- **Closed or merged PR** → done, whatever the author or reason. Largest category: every merge and every landed bump leaves a read-but-not-done thread.
- **Bot or self activity on your own PR** → done. PR author is you, repo owner is you, and the latest actor is you or a bot (`type` `Bot`): your own automation (Worktrunk, Greptile, CI) and replies on your own work. Exception: a *different* human as latest actor is real feedback, leave it. Personal namespace only, not shared orgs.
- **Open human thread** (`reason` `mention`/`comment`, or a person authored) → leave.
- **Open non-Dependabot bot** (e.g. `github-actions[bot]` generated content) → leave; the diff is real.
- **Open Dependabot, `CLEAN`, you have push** → merge, then done.
- **Open Dependabot, not mergeable, low-importance** → done, leave PR open. Low-importance: `deps-dev` tooling (eslint, prettier, globals, ncc, `@types/*`) and routine CI-action bumps (`actions/checkout`, `actions/cache`, `goreleaser-action`).
- **Open Dependabot, not mergeable, runtime/prod dep** → leave. Shipped deps, Go modules, security bumps (`golang.org/x/*`, `through2`, `undici`) are a real call.
- **Non-PR**: `Release` → done; `RepositoryAdvisory` → leave (security).

Ambiguous importance (a `deps-dev` bump that ships, a flaky-looking prod failure) → `AskUserQuestion`. Merges and dismissals are the user's call.

## Act

Under `--dry-run`, print the plan and stop.

Merge with `gh pr merge <n> --repo <r> --squash`. Failure with `add the --admin flag` means branch protection is blocking it: do **not** pass `--admin`, leave and report as needs-review. Within one repo, same-file bumps go `BEHIND` after the first merge. Leave them for Dependabot to rebase.

Mark done with `gh api --method DELETE notifications/threads/<id>` (`204` = ok). `DELETE` marks done. `PATCH` only marks read. Mark done *after* a merge, not before: the merge event resurfaces the thread once, and a rerun catches it under the closed/merged rule.

## Verify

Done has no REST read-back: `all=true` still lists done threads and `GET .../threads/<id>` still returns `200`, so a clean Inbox can't be confirmed by re-listing. Trust the `204`s. Report what you merged, dismissed, and left (one line each), and tell the user to confirm in the app.
