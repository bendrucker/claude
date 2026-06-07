---
paths:
  - "**/*.ts"
---

# Bun

Hooks and scripts use [Bun](https://bun.sh) to run TypeScript. Bun auto-installs missing registry dependencies on first run, so most scripts run without a prior `bun install`.

#### Workspace Dependencies

Auto-install does not cover `workspace:*` specifiers. Scripts that import workspace packages (`@bendrucker/*`) need `bun install` first to create the `node_modules` symlinks; without it they fail with `Cannot find module`. The project Worktrunk `post-start` hook (`.config/wt.toml`) runs `bun install` for new worktrees so this resolves automatically.

# Script Conventions

When writing scripts (hooks, skill CLIs, etc.) that accept arguments:

- **Argument parsing**: Use [cleye](https://github.com/privatenumber/cleye) for type-safe argument parsing with automatic `--help` generation. Load the `cleye` skill for usage patterns (parameters, flags, subcommands) instead of reading existing scripts.
- **Table output**: Use the `table` package for formatted terminal table output. Do not use `markdown-table` or similar GFM-oriented packages, script output is displayed in a terminal, not rendered as markdown.
- **Ancestor paths**: Use `join(import.meta.dirname, "..")` to resolve parent directories. Avoid chaining `dirname()` calls; explicit `".."` is clearer.

# Terminal Colors

Use ANSI colors (0-15) in scripts that produce terminal output. These are remapped by the terminal theme (Catppuccin), so they adapt to both light and dark mode. Avoid 256-color or truecolor escapes for foreground text.

# Sandbox and Nested Commands

`excludedCommands` matches only the top-level command of a Bash invocation. Nested commands (e.g., `open` spawned from a `bun scripts/foo.ts` wrapper) inherit the parent's sandbox profile, so adding `open:*` to `excludedCommands` does not exempt nested calls.

`${CLAUDE_PLUGIN_ROOT}` does NOT expand in hook `matcher` fields (it only expands in `command` strings). A matcher like `Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/:*)` is compared literally against the resolved cache path (`bun /Users/.../plugins/cache/.../scripts/foo.ts`), never matches, and the hook never fires. Do not use `${CLAUDE_PLUGIN_ROOT}` in matchers.

The working mechanism is the `mac` plugin's marker-based sandbox hook. It uses a broad `Bash|Monitor` matcher and reads the head of the invoked `bun`/`node` script for the comment `claude:dangerouslyDisableSandbox`. When present, it injects `dangerouslyDisableSandbox: true`. This is layout-independent, so it works regardless of the cache `<hash>` path. Add the marker after the shebang of any top-level script that hands off to Launch Services:

```ts
#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: <reason>
```

The marker requires the `mac` plugin installed and only fires for interpreters in its `SCRIPT_INTERPRETERS` set (`bun`, `node`). See [`plugins/mac/README.md`](../../plugins/mac/README.md) for canonical docs.
