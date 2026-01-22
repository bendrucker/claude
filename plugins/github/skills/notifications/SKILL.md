---
name: notifications
description: Managing GitHub notifications inbox. Use when listing, filtering, or triaging notifications (mark read, done, unsubscribe).
---

# GitHub Notifications

Manage the inbox via GraphQL (list) and REST (actions). Requires `notifications` scope.

## Listing (Inbox)

Query: `graphql/inbox.graphql`

```bash
gh api graphql -f query="$(cat graphql/inbox.graphql)" \
  --jq '[.data.viewer.notificationThreads.nodes[] | select(.isDone == false)]'
```

### Fields

| Field | Description |
|-------|-------------|
| `id` | GraphQL node ID for mutations |
| `summaryId` | Numeric ID for REST actions |
| `isUnread` | Unread status |
| `isDone` | Done status (hidden from inbox) |
| `isSaved` | Saved for later |
| `reason` | `ASSIGN`, `AUTHOR`, `COMMENT`, `MANUAL`, `MENTION`, `REVIEW_REQUESTED`, `SUBSCRIBED`, `CI_ACTIVITY`, `STATE_CHANGE` |
| `url` | Browser URL (direct, no transform needed) |

## Actions

REST (use `summaryId`):

```bash
gh api -X PATCH /notifications/threads/{summaryId}                      # Mark read
gh api -X DELETE /notifications/threads/{summaryId}                     # Mark done
gh api -X PUT /notifications                                           # Mark all read
gh api -X DELETE /notifications/threads/{summaryId}/subscription        # Unsubscribe
gh api -X PUT /notifications/threads/{summaryId}/subscription -f ignored=true  # Mute
```

GraphQL mutations (use `id`):

```bash
gh api graphql -f query='mutation { markNotificationAsUnread(input: {id: "{id}"}) { success } }'
gh api graphql -f query='mutation { markNotificationAsUndone(input: {id: "{id}"}) { success } }'
```

## Filtering

Filter in jq after the GraphQL query:

```bash
# By reason
... --jq '[.data.viewer.notificationThreads.nodes[] | select(.isDone == false and .reason == "MENTION")]'

# Unread only
... --jq '[.data.viewer.notificationThreads.nodes[] | select(.isDone == false and .isUnread == true)]'
```

## Bulk Mark Done

```bash
gh api graphql -f query='...' --jq '.data.viewer.notificationThreads.nodes[] | select(.isDone == false) | .summaryId' | \
  xargs -I {} gh api -X DELETE /notifications/threads/{}
```
