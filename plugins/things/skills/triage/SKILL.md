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

Things refuses to reschedule a repeating todo. A `when` update is a no-op on one: the write reports success and the todo stays where it was. That covers Defer, Drop, and the reschedule `reorder_todos` runs on. Keep every repeating instance out of all three, whether or not it is overdue.

Completion is the only disposal Things accepts on one. Report the overdue repeating instances as a group and offer that, and leave the rest scheduled where they are.

## Grouping

Group the remaining items by area first and tag second, for batch triage.

## Triage Questions

Per group, use `AskUserQuestion`:

- **Keep**: stays on Today for prioritization
- **Defer**: to tomorrow, next week, someday, or a specific date
- **Complete**: mark done
- **Drop**: move to Someday

Offer a repeating instance Keep and Complete only. Defer and Drop both write `when`, which it rejects.

## Batch Operations

One `update_todos` call per decision group, passing every id in that group:

- Defer: `when` as `tomorrow`, `someday`, `yyyy-mm-dd`, or natural language like `next week`
- Complete: `completed: true`
- Drop: `when: "someday"`

Batches rate-limit to 250 operations per 10 seconds, so group by target rather than calling per todo.

Build the Defer and Drop batches from the one-off todos alone. A repeating instance takes `completed: true`.

## Ordering

Propose an order for kept items:

- Salaried and work items first
- Deadline items high priority
- Personal items toward the end

Present the proposed order and confirm it before writing.

## Reorder

`reorder_todos` with `list: "today"` and `ids` in confirmed top-to-bottom order.

It reschedules each todo out of Today and back, which replaces a specific date with the list itself. Hold back a todo carrying a date it needs to keep, along with every repeating instance, and say which ones were held back.

It moves the ids it receives to the top of Today in the given order, and returns the count it was handed rather than a reading of the list. Held-back todos keep their own positions below or among them.

## Summary

Re-run `list_todos` with `list: "today"` once the writes land, and read the final order off that result. The proposed order describes what was asked for, and this describes what Things holds.

Report kept, deferred by date, completed, and that final Today order as a numbered list. Name any todo whose state came back other than the decision it was given.
