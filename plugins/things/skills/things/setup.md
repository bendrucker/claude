# Things 3 JXA Development

Guide for writing JXA (JavaScript for Automation) scripts for Things 3.

## Running JXA

Use `osascript -l JavaScript -e '...'` for inline scripts:

```bash
# Get today's todo count
osascript -l JavaScript -e 'const app = Application("Things3"); const list = app.lists.byId("TMTodayListSource"); list.toDos().length;'

# List all tags
osascript -l JavaScript -e 'const app = Application("Things3"); const tags = app.tags(); const names = []; for (let i = 0; i < tags.length; i++) { names.push(tags[i].name()); } JSON.stringify(names);'

# Get inbox todos as JSON
osascript -l JavaScript -e 'const app = Application("Things3"); const inbox = app.lists.byId("TMInboxListSource"); const todos = []; const items = inbox.toDos(); for (let i = 0; i < items.length; i++) { todos.push({id: items[i].id(), name: items[i].name()}); } JSON.stringify(todos, null, 2);'
```

## JXA Arrays vs JavaScript Arrays

**CRITICAL**: JXA arrays (from methods like `list.toDos()`) are NOT JavaScript arrays.

JXA arrays have:
- `.length` property
- Can be indexed with `[i]`
- **DO NOT** have `.filter()`, `.map()`, `.forEach()`, etc.

Always use a for loop or convert manually:

```javascript
// WRONG: JXA array doesn't have .map()
// const names = list.toDos().map(t => t.name());

// CORRECT: Use a for loop
const items = list.toDos();
const names = [];
for (let i = 0; i < items.length; i++) {
  names.push(items[i].name());
}
```

## Type Definitions

The `src/` directory contains TypeScript type definitions for reference:

- **`Things3.d.ts`**: Generated from Things.app AppleScript dictionary. Covers Application, List, ToDo, Project, Area, Tag, Contact.
- **`jxa-globals.d.ts`**: Global JXA functions like `Application()`.

These provide API documentation even when writing plain JXA.
