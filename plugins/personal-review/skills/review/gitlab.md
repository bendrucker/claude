# GitLab Todos

Triage GitLab todos inbox by action type.

## Query

Load the `gitlab:todos` skill. Query pending todos.

## Group by Action

Present groups in priority order:

| Priority | Action | Typical Actions |
|----------|--------|-----------------|
| 1 | `review_requested` / `approval_required` | Review now, defer to Things |
| 2 | `assigned` / `directly_addressed` | Review now, defer to Things |
| 3 | `mentioned` | Read, respond, mark done |
| 4 | `build_failed` | Check CI, mark done |

## Actions

For each todo, use `AskUserQuestion`:

| Action | API |
|--------|-----|
| Mark done | `POST /todos/{id}/mark_as_done` |
| Defer to Things | Create task, then mark done |

## Defer to Things

Load the `things:inbox` skill. Create task with:

- **Title**: `GitLab: {project}!{iid} - {title}`
- **Notes**: Markdown link to `target.web_url`
- **Tags**: `GitLab`

Example: `GitLab: team/project!456 - Update CI pipeline config`

## Evening Variant

Simplified triage:
- Defer review requests and approvals to Things
- Mark done completed build notifications
- Skip mentions
