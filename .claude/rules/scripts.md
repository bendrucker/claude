---
paths:
  - "**/*.ts"
---

# Bun

Hooks and scripts use [Bun](https://bun.sh) to run TypeScript. Bun auto-installs missing registry dependencies on first run, so most scripts run without a prior `bun install`.

#### Workspace Dependencies

Auto-install skips `workspace:*` specifiers. A script importing a workspace package (`@bendrucker/*`) needs `bun install` first, or it fails with `Cannot find module`. The project Worktrunk `post-start` hook runs it for new worktrees, but not for `Agent(isolation='worktree')` worktrees, which skip wt hooks.

Repo-internal tooling (`scripts/`, `.claude/hooks/`) must import `packages/` code via relative paths (`../packages/marketplace/index`), so it runs in fresh worktrees without install. Reserve workspace specifiers for distributed plugin code, which cannot use relative imports across the plugin boundary.

# Decoding External Data

`JSON.parse`, subprocess stdout, file reads, and hook input on stdin all produce `unknown`. Validate each against a zod schema at the point it arrives instead of asserting a shape onto it. `user/rules/typescript.md` covers the convention.

`packages/decode` wraps zod with the source label that makes a rejection traceable: `decodeJson(schema, text, "gh pr view output")`, plus `decodeStdin`, `decodeFile`, `decodeFileLines`, and `decodeJsonLines`. Repo-internal tooling imports it relatively (`../packages/decode/index`).

Plugins cannot use it. A distributed plugin resolves its runtime deps through npm auto-install, which skips `workspace:*`, so a plugin declares `zod` in its own `package.json` and calls `schema.parse` directly.

# Script Conventions

- **Argument parsing**: use [cleye](https://github.com/privatenumber/cleye). Load the `cleye` skill for parameters, flags, and subcommands instead of reading existing scripts.
- **Table output**: use the `table` package, not `markdown-table` or another GFM-oriented package. Script output lands in a terminal.
- **Output width**: use a fixed default with a flag override (`--truncate <n>`). Do not read `process.stdout.columns` or gate on `process.stdout.isTTY`, both undefined when piped. The `local/no-terminal-width` lint rule enforces this.
- **Ancestor paths**: use `join(import.meta.dirname, "..")` rather than chained `dirname()` calls.
- **Terminal colors**: use ANSI colors 0-15, which the terminal theme remaps for light and dark mode. Avoid 256-color and truecolor escapes for foreground text.
- **Gate output**: redirect on the first run. `bun run check` and `bun test` re-execute everything each time they are called, so run `bun run check 2>&1 | tee tmp/check.log | tail -n 50` and read further into `tmp/check.log` with `sed`.

# Sandbox and Nested Commands

`excludedCommands` matches only the top-level command of a Bash invocation. Nested commands (`open` spawned from a `bun scripts/foo.ts` wrapper) inherit the parent's sandbox profile, so an `open:*` entry does not exempt them.

Go CLIs (`gh`, `glab`, `terraform`, `kubectl`, `go`) run fine sandboxed. `sandbox.network.allowMachLookup: ["com.apple.trustd.agent"]` lets Go's `crypto/x509` reach the system `trustd` daemon for TLS verification profile-wide.

Apple Events and Launch Services handoff (`osascript`, `open`, URL schemes) does not survive the sandbox even with `sandbox.allowAppleEvents`, because the child's TCC attribution changes under the Seatbelt container. These wrappers need a full sandbox skip.

Never use `${CLAUDE_PLUGIN_ROOT}` in a hook `matcher`. It expands only in `command` strings, so a matcher like `Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/:*)` is compared literally against the resolved cache path, never matches, and the hook never fires.

The `mac` plugin's marker hook provides the skip without a matcher: it reads the head of the invoked script for a `claude:dangerouslyDisableSandbox` comment and injects `dangerouslyDisableSandbox: true`. Add the marker after the shebang of any top-level script that hands off to Apple Events or Launch Services, or that writes its plugin data dir under `~/.claude/plugins`:

```ts
#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: <reason>
```

It fires for a script passed to an interpreter in `SCRIPT_INTERPRETERS` (`bun`, `node`), and for a script executed by path when its extension is in `SCRIPT_EXTENSIONS` (`.ts`, `.js`, `.mjs`, `.cjs`, `.sh`). Requires the `mac` plugin. See [`plugins/mac/README.md`](../../plugins/mac/README.md) for canonical docs.
