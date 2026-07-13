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
- **Output width**: Use a fixed default width with a flag override (e.g. `--truncate <n>`) for truncation or layout. Do not read `process.stdout.columns` or gate on `process.stdout.isTTY`. The column count is undefined when piped, and even in a terminal the output lands in Claude's context as text, so a fixed width stays predictable across both. The `no-terminal-width` prek hook enforces this.
- **Ancestor paths**: Use `join(import.meta.dirname, "..")` to resolve parent directories. Avoid chaining `dirname()` calls; explicit `".."` is clearer.

# Terminal Colors

Use ANSI colors (0-15) in scripts that produce terminal output. These are remapped by the terminal theme (Catppuccin), so they adapt to both light and dark mode. Avoid 256-color or truecolor escapes for foreground text.

# Sandbox and Nested Commands

`excludedCommands` matches only the top-level command of a Bash invocation. Nested commands (e.g., `open` spawned from a `bun scripts/foo.ts` wrapper) inherit the parent's sandbox profile, so adding `open:*` to `excludedCommands` does not exempt nested calls.

Go CLIs (`gh`, `glab`, `terraform`, `kubectl`, `go`) run fine sandboxed: `sandbox.network.allowMachLookup: ["com.apple.trustd.agent"]` in `user/settings.json` lets Go's `crypto/x509` reach the system `trustd` daemon for TLS verification profile-wide.

Apple Events and Launch Services handoff (`osascript`, `open`, URL schemes) does not survive the sandbox even with `sandbox.allowAppleEvents`, because the child process's TCC attribution changes under the Seatbelt container. These wrappers need a full sandbox skip, provided by the `mac` plugin's marker-based hook.

`${CLAUDE_PLUGIN_ROOT}` does NOT expand in hook `matcher` fields (it only expands in `command` strings). A matcher like `Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/:*)` is compared literally against the resolved cache path (`bun /Users/.../plugins/cache/.../scripts/foo.ts`), never matches, and the hook never fires. Do not use `${CLAUDE_PLUGIN_ROOT}` in matchers.

The marker hook sidesteps this: it uses a broad `Bash|Monitor` matcher and reads the head of the invoked `bun`/`node` script for the comment `claude:dangerouslyDisableSandbox`. When present, it injects `dangerouslyDisableSandbox: true`, running that command fully outside the sandbox. This is layout-independent, so it works regardless of the cache `<hash>` path. Add the marker after the shebang of any top-level script that hands off to Apple Events or Launch Services:

```ts
#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: <reason>
```

The marker requires the `mac` plugin installed and only fires for interpreters in its `SCRIPT_INTERPRETERS` set (`bun`, `node`). See [`plugins/mac/README.md`](../../plugins/mac/README.md) for canonical docs.
