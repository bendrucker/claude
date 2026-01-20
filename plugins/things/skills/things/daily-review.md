# Daily Review Workflow

Interactive process for clearing inbox, reviewing today, and planning ahead. Use `AskUserQuestion` at decision points throughout.

## Variants

**Morning Review** (10-15 min): Planning-focused. Process inbox, review today, set priorities.

**Evening Review** (5-10 min): Shutdown-focused. Capture loose ends, prepare tomorrow, clear mental load.

## Workflow Steps

### 1. Process Inbox

Read all inbox items:

```bash
scripts/run-jxa.sh '
const app = Application("Things3");
const inbox = app.lists.byId("TMInboxListSource");
const todos = inbox.toDos().map(t => ({
  id: t.id(),
  name: t.name(),
  notes: t.notes() || "",
  tags: t.tagNames(),
  createdAt: t.creationDate()?.toISOString()
}));
JSON.stringify(todos, null, 2);
'
```

**Batch by pattern**: Group items by project hints, tags, or keywords before asking. For each batch, use `AskUserQuestion`:

- **Do it now**: For quick tasks (1-2 min), complete immediately and mark done
- **Schedule**: today, tomorrow, next week, someday
- **Assign**: to existing project, to area, or leave standalone
- **Tag**: add relevant tags
- **Delete**: if no longer relevant (confirm first)

For "Do it now" tasks, help the user complete the task then mark complete:
```bash
osascript scripts/url.js update id=TODO_ID completed=true
```

**Opening links from tasks**: Extract URLs from notes and offer to open them:
```bash
open -g "https://example.com/link-from-notes"
```

Process until inbox is empty.

### 2. Review Today

Read today's list:

```bash
scripts/run-jxa.sh '
const app = Application("Things3");
const today = app.lists.byId("TMTodayListSource");
const todos = today.toDos().filter(t => {
  const props = t.properties();
  // Exclude repeating instances (created at midnight)
  if (!props.creationDate) return true;
  return props.creationDate.getHours() !== 0 ||
         props.creationDate.getMinutes() !== 0 ||
         props.creationDate.getSeconds() !== 0;
}).map(t => ({
  id: t.id(),
  name: t.name(),
  project: t.project()?.name() || null,
  notes: t.notes() || ""
}));
JSON.stringify(todos, null, 2);
'
```

For items that look stale or unclear, use `AskUserQuestion`:

- **Keep**: remains on today
- **Defer**: move to tomorrow or upcoming
- **Clarify**: break into smaller tasks
- **Complete/Delete**: if done or no longer needed

### 3. Review Tomorrow/Upcoming

Check what's scheduled for the next few days:

```bash
scripts/run-jxa.sh '
const app = Application("Things3");
const upcoming = app.lists.byId("TMCalendarListSource");
const todos = upcoming.toDos().slice(0, 20).map(t => ({
  id: t.id(),
  name: t.name(),
  when: t.activationDate()?.toISOString(),
  deadline: t.dueDate()?.toISOString()
}));
JSON.stringify(todos, null, 2);
'
```

Use `AskUserQuestion`: Should any of these move to today?

### 4. Set Priorities (Morning Only)

After reviewing today's list, use `AskUserQuestion` to confirm priority order:

> "Here are your tasks for today. Which should be your top priorities? Select in order of importance."

Present current today items and let user select/reorder.

Then reorder using the new order (highest priority first):

```bash
osascript scripts/reorder.js <first-id> <second-id> <third-id> ...
```

### 5. Create Follow-ups

When deferring or breaking down tasks, link back to the original using Things URLs:

```bash
# Create follow-up that links to original task
osascript scripts/url.js add title="Follow up on: Task Name" notes="Original: things:///show?id=ORIGINAL_ID" when=tomorrow
```

The `things:///show?id=ID` URL opens the linked task when clicked in Things.

### 6. Summary

Display:
- Items processed from inbox
- Changes made to today list
- Today's plan in priority order
- Any items deferred to later

## Example Session

**Morning review prompt from user**: "Let's do my daily review"

1. Read inbox → 5 items found
2. Group by pattern: 3 work-related, 2 personal
3. `AskUserQuestion`: "3 work items in inbox. Where should they go?"
4. User selects: today for 2, next week for 1
5. Process personal items similarly
6. Read today → 8 items (after inbox processing)
7. `AskUserQuestion`: "Here's today. Any to defer or clarify?"
8. User keeps all
9. `AskUserQuestion`: "What's your priority order for today?"
10. User selects top 3
11. Reorder with `scripts/reorder.js`
12. Display summary

## Evening Variant

Skip priority setting. Focus on:

1. Quick inbox scan (capture any remaining thoughts)
2. Review what's left on today → defer to tomorrow if incomplete
3. Preview tomorrow's schedule
4. Confirm tomorrow looks achievable

End with: "Your system is clear. Tomorrow's plan is ready."
