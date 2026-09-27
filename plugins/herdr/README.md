# Herdr

Drive the [herdr](https://herdr.dev) terminal workspace manager from a session running inside it.

## Contents

- **Skill**: [`herdr`](skills/herdr) drives workspaces, tabs, and panes, and hands whole tasks to coding agents running in other panes
- **Mod**: [`register.ts`](mod/register.ts) reports the session's lifecycle to its herdr pane from engine events, when function hooks are enabled (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`)

## Tests

`bun test plugins/herdr` runs the skill's bun tests, and `bun scripts/mod-test.ts herdr` runs the mod's.
