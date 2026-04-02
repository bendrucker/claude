---
name: things:triage
description: Triage and prioritize the Things Today list. Use when the user wants to review, prioritize, or reorder their Today list.
---

# Today List Triage

Group, prioritize, defer, and reorder the Things Today list.

## Query

Load the `things:jxa` skill. Run the query to get all Today items as JSON:

```
/mac:jxa-run Things3 ${CLAUDE_PLUGIN_ROOT}/scripts/jxa/query-list.js TMTodayListSource
```

Pipe the output through the formatter: `bun ${CLAUDE_PLUGIN_ROOT}/scripts/format-output.ts --json`

Filter to open items.

## Repeating Task Detection

Apply the midnight heuristic: a task is a repeating instance if `creationDate` ends with `T00:00:00` (midnight local time in ISO). Manually created tasks have non-zero hours/minutes/seconds.

Overdue repeating tasks (where `dueDate` or `activationDate` is before today) should be batched for a single "Defer all overdue repeating tasks to tomorrow?" prompt. Load the `things:url` skill for batch defer via URL scheme.

## Grouping

Group remaining items by area (primary) and tag (secondary) for batch triage. This is a presentation strategy — read the JSON and form logical groups.

## Triage Questions

Per group, use `AskUserQuestion`:

- **Keep** — stays on Today for prioritization
- **Defer** — to tomorrow, next week, someday, or a specific date
- **Complete** — mark done
- **Drop** — move to Someday

## Ordering

After triage, propose an order for kept items:
- Salaried/work items first
- Deadline items high priority
- Personal items toward end

Present proposed order for user confirmation.

## Reorder

Load the `things:url` skill. Use the reorder script:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/reorder.ts [--list today|anytime|someday] <id1> <id2> <id3> ...
```

Pass IDs in the confirmed priority order.

## Batch Operations

Group deferred items by target date. Use Things URL scheme for batch updates. Load `things:url` for syntax.

## Summary

Present final counts:
- Kept on Today: N
- Deferred: N (by date)
- Completed: N
- Final Today order (numbered list)
