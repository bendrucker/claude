# Things 3 JXA Development

Guide for writing JXA scripts for Things 3.

## Script Structure

Run scripts via `/mac:jxa-run Things3 <script> [args...]` (inline expressions: `-e '<expr>'`).

Define a `run(argv)` function. `osascript` calls it automatically and prints the return value:

```javascript
#!/usr/bin/env osascript -l JavaScript
function run(argv) {
  var app = Application("Things3");
  return JSON.stringify({ count: app.toDos().length });
}
```

The function must be named `run`, not `_run`. `osascript` does not call `_run`.

## JXA Arrays vs JavaScript Arrays

Collections returned by JXA calls like `list.toDos()` are not JavaScript arrays. They have `.length` and `[i]` indexing but no `.map()`, `.filter()`, or `.forEach()`. Iterate with for loops.

## Type Definitions

The `src/` directory contains TypeScript type definitions for reference:

- **`Things3.d.ts`**: Generated from Things.app AppleScript dictionary. Covers Application, List, ToDo, Project, Area, Tag, Contact.
- **`jxa-globals.d.ts`**: Global JXA functions like `Application()`.

These document the API even when writing plain JXA.
