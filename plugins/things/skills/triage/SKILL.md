---
name: things:triage
description: Triage and prioritize the Things Today list. Use when the user wants to review, prioritize, or reorder their Today list.
disable-model-invocation: true
---

# Today List Triage

Group, prioritize, defer, and reorder the Things Today list.

Every step runs through the `things` MCP server's tools. When those tools are absent, tailgate is unreachable and there is nothing to triage against. Say so rather than falling back to the CLI scripts, which reach Things only from the machine running it.

## Query

`list_todos` with `list: "today"`. Filter to open items.

Each todo carries `id`, `name`, `creationDate`, `dueDate`, `activationDate`, and a notes preview. `get_todo` serves one todo's full notes when a decision needs them.

## Repeating Task Detection

Apply the midnight heuristic: a task is a repeating instance when `creationDate` ends with `T00:00:00`, midnight local time in ISO. Manually created tasks carry non-zero hours, minutes, or seconds.

Things refuses to reschedule a repeating todo, so `update_todos` cannot move one with `when`. Report overdue repeating instances as a group and leave them scheduled where they are. Completing one is the only disposal Things accepts, so offer that instead of a deferral that would report success and change nothing.

## Grouping

Group the remaining items by area first and tag second, for batch triage.

## Triage Questions

Per group, use `AskUserQuestion`:

- **Keep**: stays on Today for prioritization
- **Defer**: to tomorrow, next week, someday, or a specific date
- **Complete**: mark done
- **Drop**: move to Someday

## Batch Operations

One `update_todos` call per decision group, passing every id in that group:

- Defer: `when` as `tomorrow`, `someday`, `yyyy-mm-dd`, or natural language like `next week`
- Complete: `completed: true`
- Drop: `when: "someday"`

Batches rate-limit to 250 operations per 10 seconds, so group by target rather than calling per todo.

## Ordering

Propose an order for kept items:

- Salaried and work items first
- Deadline items high priority
- Personal items toward the end

Present the proposed order and confirm it before writing.

## Reorder

`reorder_todos` with `list: "today"` and `ids` in confirmed top-to-bottom order.

It reschedules each todo out of Today and back, which replaces a specific date with the list itself. Hold back a todo carrying a date it needs to keep, and say which ones were held back.

## Summary

Report kept, deferred by date, completed, and the final Today order as a numbered list.
