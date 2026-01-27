---
name: jxa
description: Things 3 JXA/AppleScript operations for reading, querying, and managing tasks. Use for read operations, filtering, bulk queries, logbook analysis, and status checks.
allowed-tools: [Bash(osascript:*), Read]
hooks:
  PreToolUse:
    - matcher: "Bash(osascript:*)"
      hooks:
        - type: command
          command: |
            jq -n '{
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "allow",
                updatedInput: { dangerouslyDisableSandbox: true }
              }
            }'
---

# Things JXA

Read operations and complex management for Things 3 via JXA (JavaScript for Automation).

## Quick Start

```bash
osascript -l JavaScript -e '
const app = Application("Things3");
const today = app.lists.byId("TMTodayListSource");
JSON.stringify(today.toDos().map(t => ({id: t.id(), name: t.name()})), null, 2);
'
```

## Built-in List IDs (JXA)

- `TMInboxListSource` — Inbox
- `TMTodayListSource` — Today
- `TMNextListSource` — Anytime
- `TMCalendarListSource` — Upcoming
- `TMSomedayListSource` — Someday
- `TMLogbookListSource` — Logbook

## Common Queries

### Inbox

```bash
osascript -l JavaScript -e '
const app = Application("Things3");
const inbox = app.lists.byId("TMInboxListSource");
JSON.stringify(inbox.toDos().map(t => ({
  id: t.id(), name: t.name(), notes: t.notes(),
  tags: t.tagNames(), createdAt: t.creationDate()?.toString()
})), null, 2);
'
```

### Today

```bash
osascript -l JavaScript -e '
const app = Application("Things3");
const today = app.lists.byId("TMTodayListSource");
JSON.stringify(today.toDos().map(t => ({
  id: t.id(), name: t.name(), status: t.status().toString(),
  project: t.project()?.name(), dueDate: t.dueDate()?.toString()
})), null, 2);
'
```

### Projects, Areas, Tags

```bash
# Projects
osascript -l JavaScript -e 'const app = Application("Things3"); JSON.stringify(app.projects().map(p => ({id: p.id(), name: p.name(), area: p.area()?.name(), status: p.status().toString(), todoCount: p.toDos().length})), null, 2);'

# Areas
osascript -l JavaScript -e 'const app = Application("Things3"); JSON.stringify(app.areas().map(a => ({id: a.id(), name: a.name(), collapsed: a.collapsed(), todoCount: a.toDos().length})), null, 2);'

# Tags
osascript -l JavaScript -e 'const app = Application("Things3"); JSON.stringify(app.tags().map(t => ({id: t.id(), name: t.name(), parent: t.parentTag()?.name(), todoCount: t.toDos().length})), null, 2);'
```

### Find by Tag / Project

```bash
osascript -l JavaScript -e 'const app = Application("Things3"); const tag = app.tags.whose({name: "Work"})[0]; tag ? JSON.stringify(tag.toDos().map(t => ({id: t.id(), name: t.name(), status: t.status().toString()})), null, 2) : JSON.stringify({error: "Tag not found"});'

osascript -l JavaScript -e 'const app = Application("Things3"); const p = app.projects.whose({name: "Website Redesign"})[0]; p ? JSON.stringify(p.toDos().map(t => ({id: t.id(), name: t.name(), status: t.status().toString()})), null, 2) : JSON.stringify({error: "Project not found"});'
```

### Export to Markdown

```bash
osascript -l JavaScript -e '
const app = Application("Things3");
const today = app.lists.byId("TMTodayListSource");
let md = "# Today\n\n";
today.toDos().forEach(todo => {
  const cb = todo.status().toString() === "completed" ? "[x]" : "[ ]";
  md += cb + " " + todo.name() + "\n";
  if (todo.notes()) md += "  " + todo.notes() + "\n";
});
md;
'
```

## Logbook Queries

The logbook can contain thousands of items sorted by completion date (most recent first). Use indexed iteration with early termination.

**Performance**: ~70-80ms per `properties()` call. Full scan of 10k items: ~15-20 minutes.

### Recent Completions

```bash
osascript -l JavaScript -e '
const app = Application("Things3");
const todos = app.lists.byId("TMLogbookListSource").toDos();
const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
const result = [];
for (let i = 0; i < todos.length; i++) {
  const p = todos[i].properties();
  if (!p.completionDate || p.completionDate < cutoff) break;
  result.push({id: p.id, name: p.name, completionDate: p.completionDate});
}
JSON.stringify(result, null, 2);
'
```

### Date Range

```bash
osascript -l JavaScript -e '
const app = Application("Things3");
const todos = app.lists.byId("TMLogbookListSource").toDos();
const start = new Date("2025-12-01"), end = new Date("2025-12-31");
const result = [];
for (let i = 0; i < todos.length; i++) {
  const p = todos[i].properties();
  if (!p.completionDate) continue;
  if (p.completionDate > end) continue;
  if (p.completionDate < start) break;
  result.push({id: p.id, name: p.name, completionDate: p.completionDate});
}
JSON.stringify({count: result.length, items: result}, null, 2);
'
```

## Repeating Tasks

Detect instances using the midnight heuristic — Things sets `creationDate` to midnight (00:00:00) for auto-generated repeating instances:

```javascript
const isRepeating = props.creationDate &&
  props.creationDate.getHours() === 0 &&
  props.creationDate.getMinutes() === 0 &&
  props.creationDate.getSeconds() === 0;
```

Filter them out:

```javascript
const nonRepeating = today.toDos().filter(todo => {
  const props = todo.properties();
  if (!props.creationDate) return true;
  return props.creationDate.getHours() !== 0 ||
         props.creationDate.getMinutes() !== 0 ||
         props.creationDate.getSeconds() !== 0;
});
```

## Status Values

`open`, `completed`, `canceled` — compare with `todo.status().toString()`.

## Documentation

- **[jxa.md](jxa.md)** — Complete JXA object model and API reference
- **[setup.md](setup.md)** — TypeScript/JXA development setup, array conversion
- **[troubleshooting.md](troubleshooting.md)** — Common issues, sandbox errors, best practices

## Tips

- **JXA arrays** have `.length` and `[i]` but may lack `.map()`. Use for-loops or `Array.from()` if needed.
- **Optional chaining**: Use `todo.project()?.name()` for nullable properties.
- **Batch reads**: Use `properties()` to fetch all properties at once.
- **Launch Things first**: `open -g -a "Things3"` if not running.
