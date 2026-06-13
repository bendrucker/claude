# GitHub Notifications

Triage notifications inbox by reason.

## Query

Load the `github:notifications` skill. Query active notifications (not done).

## Pre-Triage Auto-Handling

Before presenting notifications for triage, auto-handle these patterns and report counts.

**Read mentions:** Filter where `reason == "MENTION"` and `isUnread == false`. Bulk mark done:

```bash
... --jq '[... | select(.reason == "MENTION" and .isUnread == false)] | .[].summaryId' | \
  xargs -I {} gh api -X DELETE /notifications/threads/{}
```

Report: "Auto-marked N read mentions as done"

**Already-reviewed PRs:** For each `REVIEW_REQUESTED` notification, check if the user already submitted a review:

```bash
gh pr view {url} --json reviews --jq '[.reviews[] | select(.author.login == "bendrucker")] | length'
```

If count > 0, auto-mark the notification done. Report: "Auto-marked N already-reviewed PRs as done"

## Group by Reason

Present in priority order — action needed first, then engagement, then informational.

| Priority | Reason | Typical Actions |
|----------|--------|-----------------|
| 1 | `REVIEW_REQUESTED` / `ASSIGN` | Review now, defer to Things |
| 2 | `MENTION` / `COMMENT` | Read, respond, mark done |
| 3 | `CI_ACTIVITY` / `STATE_CHANGE` / `SUBSCRIBED` | Check status, acknowledge, mark done |

## Actions

For each notification, use `AskUserQuestion`:

| Action | API |
|--------|-----|
| Mark done | `DELETE /notifications/threads/{summaryId}` |
| Mark read | `PATCH /notifications/threads/{summaryId}` |
| Unsubscribe | `DELETE /notifications/threads/{summaryId}/subscription` |
| Defer to Things | Create task, then mark done |

## Defer to Things

Load the `things:inbox` skill. Create task with:

- **Title**: `GitHub: {identifier} - {title}`
- **Notes**: Markdown link to notification URL
- **Tags**: `GitHub`

Example: `GitHub: owner/repo#123 - Fix authentication bug`

## Evening Variant

Simplified triage:
- Mark read anything already seen
- Defer blockers (review requests, assignments) to Things
- Mark done completed CI activity
- Skip detailed reading
