# Things 3 JXA Development

Guide for writing JXA scripts for Things 3.

## Running JXA

Use `/mac:jxa-run` with inline `-e` for one-off queries:

```
/mac:jxa-run Things3 -e 'var app = Application("Things3"); var list = app.lists.byId("TMTodayListSource"); list.toDos().length;'

/mac:jxa-run Things3 -e 'var app = Application("Things3"); var tags = app.tags(); var names = []; for (var i = 0; i < tags.length; i++) { names.push(tags[i].name()); } JSON.stringify(names);'
```

For script files, define a `run(argv)` function. `osascript` calls it automatically and prints the return value:

```javascript
#!/usr/bin/env osascript -l JavaScript
function run(argv) {
  var app = Application("Things3");
  return JSON.stringify({ count: app.toDos().length });
}
```

Run script files: `/mac:jxa-run Things3 <script> [args...]`

**Important**: The function must be named `run`, not `_run`. `osascript` does not call `_run`.

## JXA Arrays vs JavaScript Arrays

**CRITICAL**: JXA arrays (from methods like `list.toDos()`) are NOT JavaScript arrays.

JXA arrays have:
- `.length` property
- Can be indexed with `[i]`
- **DO NOT** have `.filter()`, `.map()`, `.forEach()`, etc.

Always use a for loop:

```javascript
// WRONG: JXA array doesn't have .map()
// var names = list.toDos().map(function(t) { return t.name(); });

// CORRECT: Use a for loop
var items = list.toDos();
var names = [];
for (var i = 0; i < items.length; i++) {
  names.push(items[i].name());
}
```

## Type Definitions

The `src/` directory contains TypeScript type definitions for reference:

- **`Things3.d.ts`**: Generated from Things.app AppleScript dictionary. Covers Application, List, ToDo, Project, Area, Tag, Contact.
- **`jxa-globals.d.ts`**: Global JXA functions like `Application()`.

These document the API even when writing plain JXA.
