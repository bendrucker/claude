# Linear Notifications

Triage Linear notifications inbox by type.

## Query

Load the `linear:notifications` skill. Query unread notifications.

## Group by Type

Present groups in priority order:

| Priority | Type | Typical Actions |
|----------|------|-----------------|
| 1 | `IssueAssignedToYou` | Review issue, start now, defer to Things |
| 2 | `IssueCommentMention` | Read, respond, archive |
| 3 | `IssueStatusChanged` | Acknowledge, archive |
| 4 | `IssuePriorityUrgent` | Review urgency, start now, defer to Things |

## Actions

For each notification, use `AskUserQuestion`:

| Action | GraphQL |
|--------|---------|
| Archive | `notificationArchive(input: { id: "..." })` |
| Mark read | `notificationMarkAsRead(input: { id: "..." })` |
| Defer to Things | Create task, then archive |

## Defer to Things

Load the `things:inbox` skill. Create task with:

- **Title**: `Linear: {identifier} - {title}`
- **Notes**: Markdown link to issue URL
- **Tags**: `Linear`

Example: `Linear: ENG-123 - Implement user authentication`

## Evening Variant

Skip entirely. Linear notifications are for focused work, not evening triage.
