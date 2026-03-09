---
name: personal-review:review
description: Interactive daily review workflow across Calendar, Things, GitHub, and Linear. Use when the user asks for a daily review, morning review, evening review, or weekly review.
---

# Daily Review

Multi-phase workflow with checkpoints between phases. Each phase ends with a summary before proceeding.

## Variants

| Variant | Calendar | Things | GitHub | GitLab | Linear | Today Triage |
|---------|----------|--------|--------|--------|--------|--------------|
| Morning | Full scan + prep | Full processing | Full triage | Full triage | Full review | Full triage |
| Evening | Tomorrow preview | Quick triage | Mark read, defer | Defer reviews | Skip | Skip |

Ask which variant if not specified.

## Phase: Calendar

Dispatch a read-only sub-agent (Task tool) to scan today's events. See [calendar.md](calendar.md).

If the sub-agent reports calendar access denied (the `"reason": "no-app-bundle"` error), skip silently. Do not prompt to fix permissions. Note "Calendar: skipped (access denied)" and proceed to the next phase.

Otherwise, present time budget (available hours, focus windows, meetings needing prep). Ask user to proceed.

## Phase: Things Inbox

See [things.md](things.md).

Batch items by pattern, ask user for each batch:
- Schedule (today/tomorrow/next week/someday)
- Assign (project/area/standalone)
- Quick do (< 2 min)
- Delete

Goal: inbox count = 0.

After inbox processing, re-query calendar (see Re-Check in [calendar.md](calendar.md)). If calendar was skipped due to access denied in the initial phase, skip the re-check too. Otherwise, present any new events and updated time budget. Ask user to proceed.

## Phase: Notifications

Dispatch read-only sub-agents in parallel (Task tool) for GitHub, GitLab, and Linear. Then triage each interactively.

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

After all notification inboxes are processed, ask user to proceed.

## Phase: Today Triage

See [triage.md](triage.md).

Group, prioritize, defer, and reorder the Today list. Present final order for confirmation.

## Summary

Present progress across all phases:
- Time budget from Calendar (or "skipped — access denied" if calendar was unavailable)
- Things inbox processed (count = 0)
- GitHub/GitLab/Linear notifications triaged (done/deferred counts)
- Today list ordered (final count)

## Defer-to-Things Format

Items deferred from GitHub/Linear:

- **Title**: `{Source}: {identifier} - {summary}`
- **Notes**: Markdown link to source
- **Tags**: Source name (GitHub, GitLab, Linear)

## Skills Used

- `calendar:calendar` — Event queries
- `things:jxa` — Read Things data
- `things:url` — Update Things items, reorder Today list
- `things:inbox` — Quick captures
- `github:notifications` — Notification triage
- `gitlab:todos` — Todo triage
- `linear:notifications` — Notification triage

## Future

- **Mail inbox**: Add `mail` skill for account-aware email archiving
- See [automation.md](automation.md) for planned auto-handling patterns.
