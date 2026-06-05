---
name: linear:notifications
disable-model-invocation: true
description: Managing Linear notifications inbox. Use when listing, filtering, or triaging Linear notifications.
allowed-tools:
  - mcp__linear
  - mcp__claude_ai_Linear
  - Bash
---

# Linear Notifications

Manage the Linear notifications inbox via `linear api`.

## Listing

```bash
linear api 'query {
  notifications(first: 50, filter: { readAt: { null: true } }) {
    nodes {
      id type readAt archivedAt
      ... on IssueNotification {
        issue { identifier title url state { name } }
        comment { body }
      }
    }
  }
}'
```

### Notification Types

| Type | Description |
|------|-------------|
| `IssueAssignedToYou` | Issue assigned to you |
| `IssueCommentMention` | Mentioned in a comment |
| `IssueStatusChanged` | Status change on subscribed issue |
| `IssuePriorityUrgent` | Issue marked urgent |

## Actions

Archive:

```bash
linear api 'mutation($id: String!) { notificationArchive(input: { id: $id }) { success } }' --variable id=NOTIFICATION_ID
```

Mark all read:

```bash
linear api 'mutation { notificationMarkAllAsRead(input: {}) { success } }'
```

## Filtering

Add filters to the query:

```graphql
notifications(first: 50, filter: { type: { eq: "IssueAssignedToYou" } })
notifications(first: 50, filter: { archivedAt: { null: true } })
```
