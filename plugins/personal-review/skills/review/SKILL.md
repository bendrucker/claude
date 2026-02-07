---
name: review
description: Interactive daily review workflow across Calendar, Things, GitHub, and Linear. Use when the user asks for a daily review, morning review, evening review, or weekly review.
---

# Daily Review

Process five inboxes in fixed order: Calendar → Things → GitHub → GitLab → Linear.

## Variants

| Variant | Calendar | Things | GitHub | GitLab | Linear |
|---------|----------|--------|--------|--------|--------|
| Morning | Full scan + prep | Full processing | Full triage | Full triage | Full review |
| Evening | Tomorrow preview | Quick triage | Mark read, defer | Defer reviews | Skip |

Ask which variant if not specified.

## Workflow

### Calendar Scan

See [calendar.md](calendar.md).

Calculate time budget:
- Available hours (workday minus meetings)
- Focus windows (90+ min gaps)
- Meetings needing prep tasks

### Things Inbox

See [things.md](things.md).

Batch items by pattern, ask user for each batch:
- Schedule (today/tomorrow/next week/someday)
- Assign (project/area/standalone)
- Quick do (< 2 min)
- Delete

Goal: inbox count = 0

### GitHub Notifications

See [github.md](github.md).

Group by reason, typical actions:

| Reason | Actions |
|--------|---------|
| `REVIEW_REQUESTED` | Review now, defer to Things |
| `ASSIGN` | Review now, defer to Things |
| `CI_ACTIVITY` | Check status, mark done |
| `MENTION`/`COMMENT` | Read, respond, mark done |

### GitLab Todos

See [gitlab.md](gitlab.md).

Group by action, typical actions:

| Action | Actions |
|--------|---------|
| `review_requested` / `approval_required` | Review now, defer to Things |
| `assigned` | Review now, defer to Things |
| `mentioned` | Read, respond, mark done |
| `build_failed` | Check CI, mark done |

### Linear Notifications

See [linear.md](linear.md).

Review unread notifications:
- **Assignments** — start now, keep on radar, defer to Things
- **Mentions** — read, respond, archive
- **Status changes** — acknowledge, archive

### Summary

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
- **Tags**: Source name (GitHub, GitLab, Linear)

## Skills Used

- `calendar:calendar` — Event queries
- `things:jxa` — Read Things data
- `things:url` — Update Things items
- `things:inbox` — Quick captures
- `github:notifications` — Notification triage
- `gitlab:todos` — Todo triage
- `linear:notifications` — Notification triage

## Future

- **Mail inbox**: Add `mail:archive` for account-aware email archiving
- See [automation.md](automation.md) for planned auto-handling patterns.
