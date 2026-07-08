# Triage Rules

The full classification matrix and the notification-API mechanics that aren't obvious from the docs.

## The Inbox the API Hides

The web and mobile Inbox is every thread that isn't done: unread plus read-but-not-done. The REST list endpoint can't reproduce that view. It filters on read state only:

- `gh api notifications` returns unread threads. It misses everything you've already opened on your phone, which is where most stale noise lives.
- `gh api "notifications?all=true"` adds read threads. This is the closest match to the Inbox, and what to triage against.

Neither call filters out done. `all=true` keeps returning a thread after you mark it done. There is no query parameter for "not done", so the REST list always overcounts the Inbox by the number of done threads. Read the whole batch with `all=true` and decide from the thread's own fields, not from the list shrinking.

## The Mark-Done Mechanic

"Done" is the state that removes a thread from the Inbox. Three endpoints, three different effects:

| Call | Effect |
| --- | --- |
| `PATCH /notifications/threads/<id>` | Marks read. Thread stays in the Inbox. |
| `DELETE /notifications/threads/<id>` | Marks **done**. Thread leaves the Inbox. Returns `204`. |
| `PUT /notifications/threads/<id>/subscription` `{"ignored":true}` | Mutes future updates. Doesn't clear the current one. |

`DELETE` is the one that clears the Inbox, and a `204` is the only confirmation you get. Done has no REST read-back: `GET /notifications/threads/<id>` still returns `200` afterward, the thread has no `done` field, and `all=true` still lists it. So you can't verify a clean Inbox by re-listing. Trust the `204`s, and point the user at the app, which is the only place the done state shows.

The thread id is the notification's `id` field, identical to the trailing segment of its `url` (`.../notifications/threads/<id>`).

## Merging Resurrects A Thread

Marking a thread done is not durable if the thread gets new activity. Merging a PR is exactly that: the merge and Dependabot's post-merge comment fire fresh events that flip the thread back to unread, back into the Inbox. Mark done after the merge lands, not before, and even then a merged PR tends to resurface once. This isn't a bug to fix. It's why triage is idempotent: a second run sweeps the merge-generated threads under the closed-or-merged rule. When you clear a large batch that included merges, run the skill again to catch the echoes.

## Merge Gate

Gate merges on `mergeStateStatus`, not on the raw checks array. One field folds in everything that matters:

| `mergeStateStatus` | Meaning | Action |
| --- | --- | --- |
| `CLEAN` | Green, mergeable, up to date | Merge |
| `BLOCKED` | Branch protection needs a review or a required check | Leave, report as needs-review |
| `BEHIND` | Base moved ahead | Leave, Dependabot rebases |
| `UNSTABLE` / `DIRTY` | A check failed, or there's a conflict | Classify by dependency importance |
| `UNKNOWN` | Not computed yet | Re-fetch once, then decide |

The legacy commit-status API (`GET /commits/<sha>/status` → `.state`) reports `pending` whenever a repo uses check-runs instead of legacy statuses, which is almost always now. It is not a reliable signal. Ignore it.

## Branch Protection

`gh pr merge` failing with `add the --admin flag` means branch protection is refusing the merge. Repos that require a review or a specific status check hit this even when CI is green. Passing `--admin` bypasses the protection the owner set up on purpose. Triage never does that. Surface the PR as needing a manual review instead.

## Importance for Non-Mergeable Dependabot PRs

When a Dependabot PR can't merge (failing, blocked on review, behind base), the choice is dismiss-the-notification versus leave-it. The split is what the bump touches, read from the PR title prefix and the package name:

- Mark done when the bump is low-importance: `deps-dev` bumps of developer tooling (linters, formatters, type stubs, test runners, bundlers, and their config packages) like `eslint`, `prettier`, `globals`, `@vercel/ncc`, `@types/*`, and routine CI-action bumps (`build(deps)` on `actions/checkout`, `actions/cache`, `goreleaser-action`). None of these ship, and a red or unreviewed build on them is churn, not signal.
- Leave it in the inbox when the bump touches something the project ships or runs: runtime `dependencies`, Go modules, and security-relevant bumps like `golang.org/x/net`, `golang.org/x/crypto`, `through2`, `undici`. A failing or blocked bump here can mean the new version breaks you, or it's a real change you should approve deliberately.

When a case doesn't fit cleanly, ask. A wrong merge or a wrong dismissal both cost more than one question.

## Within-Repo Merge Ordering

Merging several Dependabot PRs in one repo has a catch. Any two that touch the same files conflict after the first lands:

- npm bumps all touch `package.json` and the lockfile. After the first merges, the rest go `BEHIND`.
- Go module bumps all touch `go.mod` and `go.sum`. Same problem.
- Workflow-file and action bumps usually touch distinct files and merge independently.

Don't fight it. Merge the clean ones, let the `BEHIND` ones fall out, and Dependabot re-notifies once it rebases them. A second triage pass later picks them up.

## What Always Stays

Only open threads stay. A closed or merged PR is settled and gets marked done no matter who it's from, including your own.

- Open threads with `reason` of `mention` or `comment`. A human tagged you or replied.
- Open PRs authored by a person.
- Open non-Dependabot bot PRs that change real content (generated-code updates, release automation). The author is a bot but the diff isn't boilerplate.
- Your own open PRs. The thread is live work you're part of.
- `RepositoryAdvisory` notifications. A security notice is worth reading.
