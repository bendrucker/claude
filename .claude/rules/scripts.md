---
paths:
  - "**/*.ts"
---

# Bun

Hooks and scripts use [Bun](https://bun.sh) to run TypeScript. Bun auto-installs missing registry dependencies on first run, so most scripts run without a prior `bun install`.

#### Workspace Dependencies

Never use `workspace:*` in distributed plugin code. Plugins ship as raw directories via the marketplace, so the specifier is never rewritten to a real version. On an end user's machine the hook runs `bun install --cwd ${CLAUDE_PLUGIN_ROOT}`, and Bun auto-install only fetches registry packages. A `workspace:*` specifier points at a package that exists only in this monorepo, so it fails with `Cannot find module`.

Shared plugin code must instead be a **published** npm package referenced by a plain semver range, never `workspace:*`. The canonical example is [`@bendrucker/claude-plugin-toolkit`](../../packages/toolkit) (`"^0.1.0"`), which centralizes the hook runner, output builders, and input types. A plain range that matches a workspace member resolves both ways: `bun install` links the local `packages/toolkit` directory during development and CI, and end users fetch the published package from npm. Publishing is manual (see the package README). Land plugin migrations only after the referenced version is on npm.

Repo-internal tooling (`scripts/`, `.claude/hooks/`) is not distributed, so it must import `packages/` code via relative paths (e.g. `../packages/marketplace/index`) instead of the `@bendrucker/*` specifier. That keeps it running in fresh worktrees without `bun install`, which the Worktrunk `post-start` hook (`.config/wt.toml`) runs for new worktrees but not for `Agent(isolation='worktree')` worktrees.

# Script Conventions

When writing scripts (hooks, skill CLIs, etc.) that accept arguments:

- **Argument parsing**: Use [cleye](https://github.com/privatenumber/cleye) for type-safe argument parsing with automatic `--help` generation. Load the `cleye` skill for usage patterns (parameters, flags, subcommands) instead of reading existing scripts.
- **Table output**: Use the `table` package for terminal table output. Do not use `markdown-table` or similar GFM-oriented packages, script output is displayed in a terminal, not rendered as markdown.
- **Output width**: Use a fixed default width with a flag override (e.g. `--truncate <n>`) for truncation or layout. Do not read `process.stdout.columns` or gate on `process.stdout.isTTY`. The column count is undefined when piped, and even in a terminal the output lands in Claude's context as text, so a fixed width stays predictable across both. The `no-terminal-width` prek hook enforces this.
- **Ancestor paths**: Use `join(import.meta.dirname, "..")` to resolve parent directories. Avoid chaining `dirname()` calls; explicit `".."` is clearer.

# Terminal Colors

Use ANSI colors (0-15) in scripts that produce terminal output. These are remapped by the terminal theme (Catppuccin), so they adapt to both light and dark mode. Avoid 256-color or truecolor escapes for foreground text.

# Sandbox and Nested Commands

`excludedCommands` matches only the top-level command of a Bash invocation. Nested commands (e.g., `open` spawned from a `bun scripts/foo.ts` wrapper) inherit the parent's sandbox profile, so adding `open:*` to `excludedCommands` does not exempt nested calls.

Scripts that shell out to Go CLIs (`gh`, `glab`, `terraform`) or hand off to Launch Services (`open`, URL schemes) run sandboxed. The `sandbox.network.allowMachLookup` and `sandbox.allowAppleEvents` keys in `user/settings.json` cover both cases profile-wide. See [`plugins/mac/README.md`](../../plugins/mac/README.md).
