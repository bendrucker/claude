# Things 3 JXA Development

## Script Structure

Define a function named `run(argv)`. `osascript` calls it by that exact name and prints its return value:

```javascript
#!/usr/bin/env osascript -l JavaScript
function run(argv) {
  var app = Application("Things3");
  return JSON.stringify({ count: app.toDos().length });
}
```

JXA runs ES5: use `var` and for loops, since JXA collections lack `.map()` and `.filter()`. Return a JSON string, and filter with `.whose()` so Things evaluates the predicate instead of the script iterating.

## Type Definitions

`${CLAUDE_PLUGIN_ROOT}/src/` holds TypeScript definitions that document the API for plain JXA too:

- `Things3.d.ts`: generated from the Things.app AppleScript dictionary. Covers Application, List, ToDo, Project, Area, Tag, Contact.
- `jxa-globals.d.ts`: global JXA functions like `Application()`.
