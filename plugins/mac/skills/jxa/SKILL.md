---
name: mac:jxa
description: Writing JXA (JavaScript for Automation) code for macOS automation. Use when authoring JXA scripts, learning JXA syntax, or understanding how to automate macOS apps via Application() calls.
---

# JXA

JavaScript for Automation (JXA) automates macOS apps via the `Application()` bridge. It runs on JavaScriptCore (ES5).

## Language Constraints

- Use `var` (not `let`/`const`)
- Use for-loops (JXA arrays lack `.map()`, `.filter()`, `.forEach()`)
- Return a JSON string from `run()` (not an object)

```javascript
// WRONG: JXA arrays don't have .map()
// var names = app.windows().map(function(w) { return w.name(); });

// CORRECT: use a for-loop
var windows = app.windows();
var names = [];
for (var i = 0; i < windows.length; i++) {
  names.push(windows[i].name());
}
```

## Script Files

Script files define a `function run(argv)` entry point. `osascript` calls it and prints the return value. The function must be named `run`, not `_run`.

```javascript
#!/usr/bin/env osascript -l JavaScript
function run(argv) {
  var finder = Application("Finder");
  var items = finder.desktop.items();
  var names = [];
  for (var i = 0; i < items.length; i++) {
    names.push(items[i].name());
  }
  return JSON.stringify(names);
}
```

## Tips

- Use `properties()` for batch reads instead of individual getters
- Use `.whose()` for filtering when the app supports it (pushes work to the app)
- `Application.currentApplication()` accesses the current app context
- Extract sdef for any app: `sdef /Applications/AppName.app`
