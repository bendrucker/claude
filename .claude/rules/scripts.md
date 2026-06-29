---
paths:
  - "**/*.ts"
---

# Bun

Hooks and scripts use [Bun](https://bun.sh) to run TypeScript. Bun auto-installs missing registry dependencies on first run, so most scripts run without a prior `bun install`.

#### Workspace Dependencies

Auto-install does not cover `workspace:*` specifiers. Scripts that import workspace packages (`@bendrucker/*`) need `bun install` first to create the `node_modules` symlinks; without it they fail with `Cannot find module`. The project Worktrunk `post-start` hook (`.config/wt.toml`) runs `bun install` for new worktrees so this resolves automatically, but it does not cover `Agent(isolation='worktree')` worktrees, which skip wt hooks.

Repo-internal tooling (`scripts/`, `.claude/hooks/`) must import `packages/` code via relative paths (e.g. `../packages/marketplace/index`) instead of the `@bendrucker/*` specifier, so it runs in fresh worktrees without install. Reserve workspace specifiers for distributed plugin code, which cannot use relative imports across the plugin boundary.

# Script Conventions

When writing scripts (hooks, skill CLIs, etc.) that accept arguments:

- **Argument parsing**: Use [cleye](https://github.com/privatenumber/cleye) for type-safe argument parsing with automatic `--help` generation. Load the `cleye` skill for usage patterns (parameters, flags, subcommands) instead of reading existing scripts.
- **Table output**: Use the `table` package for terminal table output. Do not use `markdown-table` or similar GFM-oriented packages, script output is displayed in a terminal, not rendered as markdown.
- **Ancestor paths**: Use `join(import.meta.dirname, "..")` to resolve parent directories. Avoid chaining `dirname()` calls; explicit `".."` is clearer.

# Terminal Colors

Use ANSI colors (0-15) in scripts that produce terminal output. These are remapped by the terminal theme (Catppuccin), so they adapt to both light and dark mode. Avoid 256-color or truecolor escapes for foreground text.

# Sandbox and Nested Commands

`excludedCommands` matches only the top-level command of a Bash invocation. Nested commands (e.g., `open` spawned from a `bun scripts/foo.ts` wrapper) inherit the parent's sandbox profile, so adding `open:*` to `excludedCommands` does not exempt nested calls.

Scripts that shell out to Go CLIs (`gh`, `glab`, `terraform`) or hand off to Launch Services (`open`, URL schemes) run sandboxed. The `sandbox.network.allowMachLookup` and `sandbox.allowAppleEvents` keys in `user/settings.json` cover both cases profile-wide. See [`plugins/mac/README.md`](../../plugins/mac/README.md).
