---
name: review
description: Interactive daily review workflow across Calendar, Things, GitHub, and Linear. Use when the user asks for a daily review, morning review, evening review, or weekly review.
---

# Daily Review

Process four inboxes in fixed order: Calendar → Things → GitHub → Linear.

## Variants

| Variant | Calendar | Things | GitHub | Linear |
|---------|----------|--------|--------|--------|
| Morning | Full scan + prep | Full processing | Full triage | Full review |
| Evening | Tomorrow preview | Quick triage | Mark read, defer | Skip |

Ask which variant if not specified.

## Workflow

### 1. Calendar Scan

See [calendar.md](calendar.md).

Calculate time budget:
- Available hours (workday minus meetings)
- Focus windows (90+ min gaps)
- Meetings needing prep tasks

### 2. Things Inbox

See [things.md](things.md).

Batch items by pattern, ask user for each batch:
- Schedule (today/tomorrow/next week/someday)
- Assign (project/area/standalone)
- Quick do (< 2 min)
- Delete

Goal: inbox count = 0

### 3. GitHub Notifications

See [github.md](github.md).

Group by reason, typical actions:

| Reason | Actions |
|--------|---------|
| `REVIEW_REQUESTED` | Review now, defer to Things |
| `ASSIGN` | Review now, defer to Things |
| `CI_ACTIVITY` | Check status, mark done |
| `MENTION`/`COMMENT` | Read, respond, mark done |

### 4. Linear Inbox

See [linear.md](linear.md).

Review assigned issues:
- **Todo** — start now, keep on radar, defer to Things
- **In Progress** — check for blockers

### 5. Summary

Present progress:
- Time budget from Calendar
- Things items processed (inbox now at 0)
- GitHub notifications triaged (done/deferred)
- Linear issues reviewed
- Today's plan in priority order

## Defer-to-Things Format

Items deferred from GitHub/Linear:

- **Title**: `{Source}: {identifier} - {summary}`
- **Notes**: Markdown link to source
- **Tags**: Source name (GitHub, Linear)

## Skills Used

- `calendar:calendar` — Event queries
- `things:jxa` — Read Things data
- `things:url` — Update Things items
- `things:inbox` — Quick captures
- `github:notifications` — Notification triage
- `linear:linear` — Issue queries

## Future

See [automation.md](automation.md) for planned auto-handling patterns.
