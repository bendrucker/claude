# Things 3 TypeScript/JXA Development Setup

Guide for setting up and using TypeScript with JXA (JavaScript for Automation) for Things 3.

## Why TypeScript?

Write TypeScript scripts that compile to JXA. TypeScript provides:
- Full autocomplete on Things 3 objects from generated types (`Things3.d.ts`)
- Type safety while writing JXA code
- Normal JavaScript array methods (`.filter()`, `.map()`, etc.)

## Writing JXA Scripts in TypeScript

### Basic Pattern

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

## JXA Arrays vs JavaScript Arrays

**CRITICAL**: JXA arrays (from methods like `list.toDos()`) are NOT JavaScript arrays.

JXA arrays have:
- `.length` property
- Can be indexed with `[i]`
- **DO NOT** have `.filter()`, `.map()`, `.forEach()`, etc.

Use `toArray<T>()` to convert them:
- **Input**: JXA array-like object
- **Output**: Real JavaScript array with all array methods
- **Typed**: Generic parameter provides full type safety

Example:
```typescript
const app = Application("Things3");
const list = app.lists.byId("TMTodayListSource");

// WRONG: JXA array doesn't have .filter()
// const todos = list.toDos().filter(t => t.status() === "open");

// CORRECT: Convert to JS array first
const todos = toArray<Things3.ToDo>(list.toDos()).filter(t =>
  t.status().toString() === "open"
);
```

## Running Scripts

Two execution modes:

### File Mode

Use for complex scripts with imports and type checking:

```bash
scripts/run-jxa.sh --path src/my-script.ts
```

Example file (`src/my-script.ts`):
```typescript
import type { Things3 } from './Things3';
import { toArray } from './array';

const app = Application("Things3");
const today = app.lists.byId("TMTodayListSource");
const todos = toArray<Things3.ToDo>(today.toDos());

const open = todos.filter(t => t.status().toString() === "open");
console.log(JSON.stringify(open.map(t => ({
  id: t.id(),
  name: t.name()
})), null, 2));
```

### Inline Mode

Use for quick queries and one-off operations:

```bash
scripts/run-jxa.sh 'const app = Application("Things3"); console.log(app.version());'
```

More examples:
```bash
# Get today's todo count
scripts/run-jxa.sh 'const app = Application("Things3"); const list = app.lists.byId("TMTodayListSource"); console.log(list.toDos().length);'

# List all tags
scripts/run-jxa.sh 'const app = Application("Things3"); const tags = app.tags(); for (let i = 0; i < tags.length; i++) { console.log(tags[i].name()); }'

# Get inbox todos
scripts/run-jxa.sh 'const app = Application("Things3"); const inbox = app.lists.byId("TMInboxListSource"); const todos = inbox.toDos().map(todo => ({id: todo.id(), name: todo.name()})); JSON.stringify(todos, null, 2);'
```

## Build Process

The `scripts/run-jxa.sh` script:
1. Bundles TypeScript with esbuild (inlines all imports for file mode)
2. Outputs as IIFE (no module system) to stdout
3. Pipes to `osascript -l JavaScript -`

This means:
- No module system in the output (all imports are inlined)
- Can use ES6+ syntax (esbuild transpiles)
- Type checking happens at build time
- Full autocomplete in your editor

## Type Definitions

**`Things3.d.ts`**: Generated from Things.app AppleScript dictionary
- Provides autocomplete for all Things objects
- Covers Application, List, ToDo, Project, Area, Tag, Contact
- Import as: `import type { Things3 } from './Things3';`

**`jxa-globals.d.ts`**: Global JXA functions
- `Application()` constructor
- Other JXA runtime functions

**`array.ts`**: Utility for converting JXA arrays
- `toArray<T>()` function
- Essential for using JavaScript array methods

## Development Tips

1. **Use file mode for development**: Get type checking and autocomplete
2. **Use inline mode for quick queries**: Faster for one-liners
3. **Always convert JXA arrays**: Use `toArray()` before `.filter()`, `.map()`, etc.
4. **Type your arrays**: `toArray<Things3.ToDo>()` gives better autocomplete
5. **Check the examples**: See `src/example.ts` for working patterns
