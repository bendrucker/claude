---
name: review
description: Interactive daily review workflow for inbox, today, and priorities across Things and Calendar. Use when the user asks for a daily review, morning review, or evening review.
---

# Daily Review

Interactive process for clearing inbox, reviewing today, and planning ahead. Orchestrates across Things and Calendar.

## Variants

**Morning Review**: Planning-focused. Process inbox, review today's calendar and tasks, set priorities.

**Evening Review**: Shutdown-focused. Capture loose ends, prepare tomorrow, clear mental load.

## Workflow

### Process Inbox

Load the `things:jxa` skill. Read all inbox items and batch by pattern (project hints, tags, keywords). For each batch, use `AskUserQuestion`:

- **Schedule**: today, tomorrow, next week, someday
- **Assign**: to project, area, or standalone
- **Tag**: add relevant tags
- **Do it now**: complete quick tasks (1-2 min) immediately
- **Delete**: if no longer relevant (confirm first)

Process until inbox is empty.

### Review Calendar

Load the `calendar` skill. Check today's events. Surface scheduling conflicts with today's task list. Note any meetings that need preparation tasks.

### Review Today

Load the `things:jxa` skill. Read today's tasks, filtering out repeating instances. For stale or unclear items, use `AskUserQuestion`:

- **Keep**: remains on today
- **Defer**: move to tomorrow or upcoming
- **Clarify**: break into smaller tasks
- **Complete/Delete**: if done or irrelevant

### Set Priorities (Morning Only)

Present today's tasks and let the user select priority order. Reorder using the `things:url` skill's reorder script.

### Create Follow-ups

When deferring or breaking down tasks, use `things:url` to create linked follow-ups:

```
things:///show?id=ORIGINAL_ID
```

### Summary

Display:
- Items processed from inbox
- Calendar highlights
- Today's plan in priority order
- Items deferred

## Evening Variant

Skip priority setting. Focus on:

1. Quick inbox scan (capture remaining thoughts)
2. Review incomplete today items → defer to tomorrow
3. Preview tomorrow's calendar and tasks
4. Confirm tomorrow looks achievable

End with: "Your system is clear. Tomorrow's plan is ready."
