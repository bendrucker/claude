# GitLab Todos

Triage GitLab todos inbox by action type.

## Query

List pending todos:

```bash
glab api /todos --paginate | jq '[.[] | select(.state == "pending")]'
```

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

## Open MRs

Review open merge requests you authored at the group level.

### Query

Fetch your user ID first — `author_username` is silently ignored on group-level MR queries, returning unfiltered results.

```sh
glab api user | jq '.id'
```

Then query open MRs by `author_id`:

```sh
glab api groups/<group>/merge_requests --paginate -f state=opened -f author_id=<id>
```

### Triage

For each MR, use `AskUserQuestion` for next steps (e.g., follow up on review, rebase, close).

## Evening Variant

Simplified triage:
- Defer review requests and approvals to Things
- Mark done completed build notifications
- Skip mentions
- Skip open MRs
