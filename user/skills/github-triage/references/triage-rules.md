# Triage Rules

The full classification matrix and the notification-API mechanics that aren't obvious from the docs.

## The Mark-Done Mechanic

The notifications API is awkward about "done", which is the state that removes a thread from the inbox UI. Three endpoints, three different effects:

| Call | Effect |
| --- | --- |
| `PATCH /notifications/threads/<id>` | Marks read. Thread stays in the inbox. |
| `DELETE /notifications/threads/<id>` | Marks **done**. Thread leaves the inbox. Returns `204`. |
| `PUT /notifications/threads/<id>/subscription` `{"ignored":true}` | Mutes future updates. Doesn't clear the current one. |

`DELETE` is the one that clears the inbox. Done is not deletion: `GET /notifications/threads/<id>` still returns `200` afterward, and the thread reappears in the "Done" tab. So never verify a dismissal by fetching the thread. Verify by its absence from `gh api notifications`.

The thread id is the notification's `id` field, identical to the trailing segment of its `url` (`.../notifications/threads/<id>`).

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

## Importance for Failing Dependabot PRs

The split is what the bump touches, read from the PR title prefix and the package name:

- **Low-importance (dismiss the notification):** `deps-dev` bumps of developer tooling. Linters, formatters, type stubs, test runners, bundlers, and their config packages. Examples: `eslint`, `prettier`, `globals`, `@vercel/ncc`, `@types/*`. A failing build here is tooling churn.
- **Important (leave in inbox):** anything the project ships or runs. Runtime `dependencies`, Go modules, security-relevant bumps (`golang.org/x/net`, `through2`). A failing bump on these can mean the new version breaks you, which is worth seeing.

CI action bumps (`build(deps)` on `actions/checkout`, `actions/cache`, `goreleaser-action`) sit between the two. They're infrastructure, not shipped code, but a failure can break the whole pipeline. Treat a clean one as mergeable and a failing one as important enough to leave.

When a case doesn't fit cleanly, ask. A wrong merge or a wrong dismissal both cost more than one question.

## Within-Repo Merge Ordering

Merging several Dependabot PRs in one repo has a catch. Any two that touch the same files conflict after the first lands:

- npm bumps all touch `package.json` and the lockfile. After the first merges, the rest go `BEHIND`.
- Go module bumps all touch `go.mod` and `go.sum`. Same problem.
- Workflow-file and action bumps usually touch distinct files and merge independently.

Don't fight it. Merge the clean ones, let the `BEHIND` ones fall out, and Dependabot re-notifies once it rebases them. A second triage pass later picks them up.

## What Always Stays

- Threads with `reason` of `mention` or `comment`. A human tagged you or replied.
- PRs authored by a person, regardless of reason.
- Non-Dependabot bot PRs that change real content (generated-code updates, release automation). The author is a bot but the diff isn't boilerplate.
- Your own open or recently closed PRs. The notification is a thread you're part of.
