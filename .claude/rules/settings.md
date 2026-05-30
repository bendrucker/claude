---
paths:
  - "**/settings*.json"
---

# Settings

User-level settings live in `user/settings.json` (plugins, permissions, sandbox). Project-level settings live in `.claude/settings.json` (biome hook). See the [settings documentation](https://docs.anthropic.com/en/docs/claude-code/settings) for available options.

## Permission Paths

Permission patterns starting with `/` are relative to the settings file, not absolute filesystem paths. Use `//` for absolute paths:

- `Edit(tmp/**)` → `<cwd>/tmp/**` (relative to current directory)
- `Edit(//tmp/**)` → `/tmp/**` (absolute)
- `Edit(~/.config/**)` → home directory (tilde expansion works)

## Sandbox and Nested Commands

`excludedCommands` matches only the top-level command of a Bash invocation. Nested commands (e.g., `open` spawned from a `bun scripts/foo.ts` wrapper) inherit the parent's sandbox profile, so adding `open:*` to `excludedCommands` does not exempt nested calls. The convention is a per-plugin PreToolUse hook that emits `dangerouslyDisableSandbox: true`. See [`scripts.md`](scripts.md) for the matcher pattern and canonical examples.
