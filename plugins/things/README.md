# Things Plugin

Interacting with Things 3 task manager for Mac via Claude Code.

Uses only **public APIs** from Cultured Code — URL scheme (`things:///`) for writes, JXA/AppleScript for reads. No direct SQLite database access.

## Contents

### Skills

- **inbox** — Quick inbox capture for delegating tasks from a coding session
- **url** — Full URL scheme operations (add, update, json, show, search, reorder) with xcall verification
- **jxa** — JXA/AppleScript read operations, queries, filtering, logbook analysis
- **triage** — Today list triage: group, prioritize, defer, reorder

### Scripts

- `scripts/jxa/` — JXA query scripts (`osascript`) returning JSON: `find-todos.js`, `query-list.js`, `query-logbook.js`, `query-metadata.js`
- `scripts/format-output.ts` — Generic stdin JSON → table formatter with `--json`, `--columns`, `--count-prefix`
- `scripts/url.ts` — URL scheme wrapper with auth token, encoding, and bulk update via JSON command
- `scripts/reorder.js` — List reordering without SQLite writes

### Hooks

- `hooks/validate-jxa.ts` — PreToolUse hook: validates `osascript` commands target Things3 plugin scripts or inline Things3 queries

Write verification uses the `x-callback-url` plugin's `xcall` skill.

## Testing

```bash
bun test plugins/things
```
