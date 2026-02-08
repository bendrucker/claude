---
name: linear:notifications
description: Managing Linear notifications inbox. Use when listing, filtering, or triaging Linear notifications.
allowed-tools:
  - mcp__linear
  - Bash
---

# Linear Notifications

<!-- TODO: Switch to `linear api` when the CLI api subcommand lands (https://github.com/bendrucker/claude/issues/353) -->

Manage the Linear notifications inbox via GraphQL. Use `query.ts` from the `linear:linear` skill for ad-hoc queries until the Linear CLI gains an `api` subcommand.

## Listing

```bash
bun ${SCRIPTS}/query.ts 'query {
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

Where `${SCRIPTS}` is the `scripts/` directory from the `linear:linear` skill.

### Notification Types

| Type | Description |
|------|-------------|
| `IssueAssignedToYou` | Issue assigned to you |
| `IssueCommentMention` | Mentioned in a comment |
| `IssueStatusChanged` | Status change on subscribed issue |
| `IssuePriorityUrgent` | Issue marked urgent |

## Actions

Archive:

```graphql
mutation { notificationArchive(input: { id: "..." }) { success } }
```

Mark all read:

```graphql
mutation { notificationMarkAllAsRead(input: {}) { success } }
```

## Filtering

Add filters to the query:

```graphql
notifications(first: 50, filter: { type: { eq: "IssueAssignedToYou" } })
notifications(first: 50, filter: { archivedAt: { null: true } })
```
