---
paths:
  - "**/*.ts"
---

# Bun

Hooks and scripts use [Bun](https://bun.sh) to run TypeScript. Bun auto-installs missing registry dependencies on first run, so repo-local scripts run without a prior `bun install`.

Distributed plugin code does not get that guarantee. Auto-install needs the registry at the moment the script runs, and a sandboxed session reaches it through a filtering proxy, so a plugin script whose dependency has never been fetched fails on a resolution error instead of installing it. Claude Code installs a cached plugin's dependencies up front instead, covered in [`plugins.md`](plugins.md).

#### Workspace Dependencies

Auto-install skips `workspace:*` specifiers. A script importing a workspace package (`@bendrucker/*`) needs `bun install` first, or it fails with `Cannot find module`. The project Worktrunk `post-start` hook runs it for new worktrees, but not for `Agent(isolation='worktree')` worktrees, which skip wt hooks.

Repo-internal tooling (`scripts/`, `.claude/hooks/`) must import `packages/` code via relative paths (`../packages/marketplace/index`), so it runs in fresh worktrees without install. Reserve workspace specifiers for distributed plugin code, which cannot use relative imports across the plugin boundary.

# Decoding External Data

`packages/decode` wraps zod with a source label so a rejection is traceable (e.g. `decodeJson(schema, text, "gh pr view output")`). Repo-internal tooling imports it relatively (`../packages/decode/index`).

Plugins cannot use it. Workspace specifiers never resolve in a cached plugin, so a plugin declares `zod` in its own `package.json` and calls `schema.parse` directly.

A plugin hook that gates a tool call drops the dependency instead. A missing package throws at import, and Claude Code treats a hook that wrote nothing to stdout as a hook with no decision to add, so the call proceeds ungated. Such a hook imports only node builtins and narrows its input with a `value is T` predicate over the one field it reads. [`plugins/mac/hooks/sandbox.ts`](../../plugins/mac/hooks/sandbox.ts) is the only one, and a test runs a copy of it from a directory with no `node_modules` above it.

# Parsing Structured Text

Parse structured text with a real parser and match against the tree it returns.

A regex over lines carries no grammar state, so it misreads delimiters in strings and comments, escapes, multi-line constructs, and nesting.

Pick the parser by what is being read:

- **Source code**: [`ast-grep`](https://ast-grep.github.io), which matches structurally with code-shaped patterns across every language its tree-sitter grammars cover.
- **Markdown**: `mdast-util-from-markdown` to parse and `unist-util-visit` to walk, typed by `@types/mdast`. [`plugins/pull-request/scripts/prose.ts`](../../plugins/pull-request/scripts/prose.ts) is the reference use.
- **Data formats**: the format's own loader, such as `JSON.parse` or the `yaml` package, which returns a tree directly.

A distributed plugin declares its parser as a registry dependency in its own `package.json`. The `workspace:*` restriction in [`plugins.md`](plugins.md) does not apply to it.

A regex is fine inside a single node's text, where the grammar is already resolved: matching a word within one paragraph, a flag within one command string.

# Script Conventions

- **Argument parsing**: use [commander](https://github.com/tj/commander.js) through `@commander-js/extra-typings`. Load the `cli` skill rather than reading existing scripts. Scripts still on cleye migrate over time.
- **Table output**: use the `table` package, not `markdown-table` or another GFM-oriented package.
- **Output width**: use a fixed default with a flag override (`--truncate <n>`). Do not read `process.stdout.columns` or gate on `process.stdout.isTTY`, both undefined when piped. The `local/no-terminal-width` lint rule enforces this.
- **Ancestor paths**: use `join(import.meta.dirname, "..")` rather than chained `dirname()` calls.
- **Terminal colors**: use ANSI colors 0-15, which the terminal theme remaps for light and dark mode. Avoid 256-color and truecolor escapes for foreground text.
- **Gate output**: run `bun run check 2>&1 | tee tmp/check.log | tail -n 50` once and read further from `tmp/check.log` with `sed`.

# Sandbox and Nested Commands

Apple Events and Launch Services handoff (`osascript`, `open`, URL schemes) does not survive the sandbox even with `sandbox.allowAppleEvents`, because the child's TCC attribution changes under the Seatbelt container. These wrappers need a full sandbox skip.

The `mac` plugin's marker hook provides the skip without a matcher: it reads the head of the invoked script for a `claude:dangerouslyDisableSandbox` comment and injects `dangerouslyDisableSandbox: true`. Add the marker after the shebang of any top-level script that hands off to Apple Events or Launch Services, or that writes its plugin data dir under `~/.claude/plugins`:

```ts
#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: <reason>
```

It fires for scripts run through `bun` or `node`, or executed by path with a script extension (see `SCRIPT_INTERPRETERS` and `SCRIPT_EXTENSIONS` in [`plugins/mac/hooks/sandbox.ts`](../../plugins/mac/hooks/sandbox.ts)). See [`plugins/mac/README.md`](../../plugins/mac/README.md) for details.
