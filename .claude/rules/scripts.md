---
paths:
  - "**/*.ts"
---

# Bun

Hooks and scripts use [Bun](https://bun.sh) to run TypeScript. Bun auto-installs missing dependencies on first run, eliminating the need to run `bun install` before executing scripts. This simplifies hook execution since hooks run in isolated contexts where `node_modules` may not be readily available.

# Script Conventions

When writing scripts (hooks, skill CLIs, etc.) that accept arguments:

- **Argument parsing**: Use [cleye](https://github.com/privatenumber/cleye) for type-safe argument parsing with automatic `--help` generation
- **Table output**: Use the `table` package for formatted terminal table output. Do not use `markdown-table` or similar GFM-oriented packages, script output is displayed in a terminal, not rendered as markdown.
- **Ancestor paths**: Use `join(import.meta.dirname, "..")` to resolve parent directories. Avoid chaining `dirname()` calls; explicit `".."` is clearer.

# Terminal Colors

Use ANSI colors (0-15) in scripts that produce terminal output. These are remapped by the terminal theme (Catppuccin), so they adapt to both light and dark mode. Avoid 256-color or truecolor escapes for foreground text.

# Sandbox and Nested Commands

`excludedCommands` matches only the top-level command of a Bash invocation. Nested commands (e.g., `open` spawned from a `bun scripts/foo.ts` wrapper) inherit the parent's sandbox profile, so adding `open:*` to `excludedCommands` does not exempt nested calls. The convention is a per-plugin PreToolUse hook scoped to the wrapping `bun ${CLAUDE_PLUGIN_ROOT}/scripts/...:*` matcher that emits `dangerouslyDisableSandbox: true`. See [`plugins/things/hooks/`](../../plugins/things/hooks/) and [`plugins/x-callback-url/hooks/`](../../plugins/x-callback-url/hooks/) for canonical examples:

```json
{
  "matcher": "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/:*)",
  "hooks": [
    { "type": "command", "command": "bun \"${CLAUDE_PLUGIN_ROOT}/hooks/sandbox.ts\"" }
  ]
}
```
