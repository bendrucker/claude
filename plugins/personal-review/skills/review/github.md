# GitHub Notifications

Triage notifications inbox by reason.

## Query

Load the `github:notifications` skill. Query active notifications (not done).

## Group by Reason

| Reason | Typical Actions |
|--------|-----------------|
| `REVIEW_REQUESTED` | Review now, defer to Things |
| `ASSIGN` | Review now, defer to Things |
| `CI_ACTIVITY` | Check status, mark done |
| `MENTION` / `COMMENT` | Read, respond, mark done |
| `STATE_CHANGE` | Acknowledge, mark done |
| `SUBSCRIBED` | Read if relevant, unsubscribe if noisy |

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
