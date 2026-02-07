# Things Plugin

Interacting with Things 3 task manager for Mac via Claude Code.

Uses only **public APIs** from Cultured Code — URL scheme (`things:///`) for writes, JXA/AppleScript for reads. No direct SQLite database access.

## Contents

### Skills

- **inbox** — Quick inbox capture for delegating tasks from a coding session
- **url** — Full URL scheme operations (add, update, json, show, search, reorder) with xcall verification
- **jxa** — JXA/AppleScript read operations, queries, filtering, logbook analysis

### Scripts

- `scripts/url.ts` — URL scheme wrapper with auth token, encoding, and bulk update via JSON command
- `scripts/reorder.js` — List reordering without SQLite writes

Write verification uses the `x-callback-url` plugin's `xcall` skill.
