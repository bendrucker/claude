---
name: things
description: Interacting with Things 3 task manager for Mac. Use when working with the user's personal todos, tasks, projects, areas, tags, or task lists (inbox, today, upcoming, etc.). Supports creating, reading, updating, and navigating tasks.
allowed-tools: [Bash(osascript:*), Bash(open:*), Read]
---

# Things 3 Task Manager

Interact with Things 3, the user's personal task manager for Mac.

## Key Concepts

- **Read operations**: Use TypeScript with esbuild to write type-safe JXA code
- **Write operations**: Use `things://` URL schemes (`things:///add`, `things:///update`, `things:///json`)
- **Updates**: Require auth token from Things > Settings > General
  - **Auth token**: Store in keychain for automated access: `security find-generic-password -a "$USER" -s "things-auth-token" -w`
  - **Initial setup**: Get token from 1Password and store in keychain (one-time, see `@1password.md`)
  - **Background processes**: Keychain access works without prompts for launchd agents and automation
  - See `@1password.md` for setup and authentication guide
- **URL encoding**: Always URL-encode parameters (spaces → `%20`, newlines → `%0a`)
- **Verification**: ALWAYS verify updates succeeded by reading back the todo with JXA
- **Repeating tasks**: Filter by comparing `creationDate` to `activationDate` (see below)

## TypeScript Setup

Write TypeScript scripts that compile to JXA (JavaScript for Automation). TypeScript provides:
- Full autocomplete on Things 3 objects from generated types (`Things3.d.ts`)
- Type safety while writing JXA code
- Normal JavaScript array methods (`.filter()`, `.map()`, etc.)

### Writing JXA Scripts in TypeScript

1. **Import types**: Use the generated `Things3.d.ts` for autocomplete
2. **Convert JXA arrays**: Use `toArray()` from `array.ts` to convert JXA arrays to JavaScript arrays
3. **Write normal TypeScript**: Use `.filter()`, `.map()`, and other array methods

```typescript
import type { Things3 } from './Things3';
import { toArray } from './array';

const app = Application("Things3");
const list = app.lists.byId("TMTodayListSource");

// Convert JXA array to JS array for .filter(), .map(), etc.
const todos = toArray<Things3.ToDo>(list.toDos());

// Now use normal array methods
const filtered = todos.filter(t => t.notes().length > 0);
const names = filtered.map(t => t.name());

console.log(JSON.stringify(names, null, 2));
```

### JXA Arrays vs JavaScript Arrays

JXA arrays (from methods like `list.toDos()`) are NOT JavaScript arrays. They have `.length` and can be indexed with `[i]`, but don't have `.filter()`, `.map()`, etc.

Use `toArray<T>()` to convert them:
- **Input**: JXA array-like object
- **Output**: Real JavaScript array with all array methods
- **Typed**: Generic parameter provides full type safety

### Running Scripts

Two modes:

**From a file:**
```bash
scripts/run-jxa.sh --path src/my-script.ts
```

**Inline TypeScript:**
```bash
scripts/run-jxa.sh 'const app = Application("Things3"); console.log(app.version());'
```

Inline mode is useful for quick queries and one-off operations:
```bash
# Get today's todo count
scripts/run-jxa.sh 'const app = Application("Things3"); const list = app.lists.byId("TMTodayListSource"); console.log(list.toDos().length);'

# List all tags
scripts/run-jxa.sh 'const app = Application("Things3"); const tags = app.tags(); for (let i = 0; i < tags.length; i++) { console.log(tags[i].name()); }'
```

The script:
1. Bundles TypeScript with esbuild (inlines all imports for file mode)
2. Outputs as IIFE (no module system) to stdout
3. Pipes to `osascript -l JavaScript -`

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
scripts/run-jxa.sh '
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
scripts/run-jxa.sh '
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

**IMPORTANT**: Always retrieve the auth token and verify updates:

```bash
# Get auth token
auth_token=$(security find-generic-password -a "$USER" -s "things-auth-token" -w)

# Encode notes
notes=$'\n\nAdditional info here'
encoded=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.stdin.read()))" <<< "$notes")

# Update todo
open "things:///update?id=ABC-123&auth-token=$auth_token&append-notes=$encoded"

# Verify the update worked
scripts/run-jxa.sh --path src/verify-todo.ts
```

### Navigate to List

Built-in lists: `inbox`, `today`, `anytime`, `upcoming`, `someday`, `logbook`

```bash
open "things:///show?id=today"
```

## Documentation

- Complete URL scheme reference: `@url-scheme.md`
- JXA object model and properties: `@jxa.md`
- 1Password authentication setup: `@1password.md`
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

## Filtering Repeating Tasks

If the user asks about "repeating" or "recurring" todos, you need to use a special heuristic to detect this because it is not explicitly exposed in JXA.

**Detection rule**: Repeating task instances have `creationDate` at midnight (00:00:00 local time). This indicates the task was auto-generated by Things from a template. Manually created tasks have creation timestamps with non-zero hours/minutes/seconds.

```bash
scripts/run-jxa.sh '
const app = Application("Things3");
const today = app.lists.byId("TMTodayListSource");
const nonRepeating = today.toDos().filter(todo => {
  const props = todo.properties();
  if (!props.creationDate) return true;
  return props.creationDate.getHours() !== 0 ||
         props.creationDate.getMinutes() !== 0 ||
         props.creationDate.getSeconds() !== 0;
}).map(todo => {
  const props = todo.properties();
  return {
    id: props.id,
    name: props.name,
    notes: props.notes || ""
  };
});
JSON.stringify(nonRepeating, null, 2);
'
```

See `@jxa.md` section "Detecting Repeating Tasks" for detailed explanation.

## Troubleshooting

### Updates Not Working

If updates don't apply changes:

1. **Verify auth token**: Get token from keychain and check it matches Things settings
2. **Verify immediately**: Read the todo back with JXA to confirm changes applied

### Best Practices

✅ **DO** verify every update by reading the todo back with JXA
✅ **DO** retrieve auth token from keychain before each update session
✅ **DO** store auth token in keychain for easy retrieval
