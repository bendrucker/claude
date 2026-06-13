# Things Inbox

Process inbox items to zero using batch triage.

## Query

Load the `things:jxa` skill. Query inbox items using `TMInboxListSource`.

## Batch Processing

Group items by pattern:
- Project hints — items mentioning "PR", "review", or repo names batch as code review
- Tags — similar tags or topics (e.g., all `errands` items)
- Keywords — related subjects (e.g., multiple items about the same feature)
- Source — items captured from same context (e.g., meeting notes)

For each batch, use `AskUserQuestion`:

| Action | Description |
|--------|-------------|
| Schedule | today, tomorrow, next week, someday |
| Assign | to project, area, or standalone |
| Tag | add relevant tags |
| Quick do | complete immediately (< 2 min) |
| Delete | no longer relevant (confirm first) |

## Execution

Load the `things:url` skill for mutations:
- Use `update` to set `when`, `list-id`, or `tags`
- Use `add` to create follow-ups if breaking down tasks
- For quick-do items, mark complete or tell user to do it now

## Goal

Inbox count = 0

## Evening Variant

Quick triage only:
- Capture remaining thoughts as new inbox items
- Defer stale items to tomorrow
- Skip detailed organization
