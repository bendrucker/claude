---
name: things
description: Interacting with Things 3 task manager for Mac. Use when working with the user's personal todos, tasks, projects, areas, tags, or task lists (inbox, today, upcoming, etc.). Supports creating, reading, updating, and navigating tasks.
allowed-tools: [Bash(osascript:*), Bash(open:*), Read]
---

# Things 3 Task Manager

Interact with Things 3, the user's personal task manager for Mac.

## Key Concepts

- **Read operations**: Use JXA (JavaScript for Automation) via `osascript -l JavaScript`
- **Write operations**: Use `things://` URL schemes (`things:///add`, `things:///json`)
- **Updates**: Require auth token from Things > Settings > General
- **URL encoding**: Always URL-encode parameters (spaces → `%20`, newlines → `%0a`)

## Common Operations

### Create a Todo

Simple todo with `things:///add`:

```bash
open "things:///add?title=Buy%20groceries&when=today&tags=Errands"
```

Complex todo with checklist using `things:///json`:

```bash
data='[{"type":"to-do","attributes":{"title":"Plan vacation","when":"today","checklist-items":[{"type":"checklist-item","attributes":{"title":"Check flights"}},{"type":"checklist-item","attributes":{"title":"Book hotel"}}]}}]'
open "things:///json?data=$(echo "$data" | jq -sRr @uri)"
```

### Read Inbox

```bash
osascript -l JavaScript -e '
const app = Application("Things3");
const inbox = app.lists.byId("TMInboxListSource");
const todos = inbox.toDos().map(todo => ({
  id: todo.id(),
  name: todo.name(),
  notes: todo.notes(),
  tags: todo.tagNames()
}));
JSON.stringify(todos, null, 2);
'
```

### Read Today List

```bash
osascript -l JavaScript -e '
const app = Application("Things3");
const today = app.lists.byId("TMTodayListSource");
const todos = today.toDos().map(todo => ({
  id: todo.id(),
  name: todo.name(),
  status: todo.status().toString()
}));
JSON.stringify(todos, null, 2);
'
```

### Update a Todo

```bash
open "things:///update?id=ABC-123&auth-token=YOUR_TOKEN&append-notes=More%20info"
```

### Navigate to List

Built-in lists: `inbox`, `today`, `anytime`, `upcoming`, `someday`, `logbook`

```bash
open "things:///show?id=today"
```

## Documentation

- Complete URL scheme reference: `@url-scheme.md`
- JXA object model and properties: `@jxa.md`
- Usage examples: `@examples.md`

## Quick Reference

### Built-in List IDs
- `TMInboxListSource` - Inbox
- `TMTodayListSource` - Today
- `TMNextListSource` - Anytime
- `TMCalendarListSource` - Upcoming
- `TMSomedayListSource` - Someday
- `TMLogbookListSource` - Logbook

### When Values
- `today`, `tomorrow`, `evening`
- `anytime`, `someday`
- `yyyy-mm-dd` (specific date)
- Natural language: "in 3 days", "next week"

### Status Values (JXA)
- `open` - Active todo
- `completed` - Completed
- `canceled` - Canceled
