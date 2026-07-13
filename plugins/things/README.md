# Things Plugin

Interacting with Things 3 task manager for Mac via Claude Code.

Uses only **public APIs** from Cultured Code — URL scheme (`things:///`) for writes, JXA/AppleScript for reads. No direct SQLite database access.

## Contents

### Skills

- **url** — URL scheme operations (add, update, json, show, search, reorder) plus quick inbox capture, with xcall verification
- **jxa** — JXA/AppleScript read operations, queries, filtering, logbook analysis
- **triage** — Today list triage: group, prioritize, defer, reorder

### Scripts

- `scripts/jxa/` — JXA query scripts (`osascript`) returning JSON: `find-todos.js`, `query-list.js`, `query-logbook.js`, `query-metadata.js`
- `scripts/format-output.ts` — Generic stdin JSON → table formatter with `--json`, `--columns`, `--count-prefix`
- `scripts/url.ts` — URL scheme wrapper with auth token, encoding, and bulk update via JSON command
- `scripts/reorder.ts` — List reordering via URL scheme (bun TypeScript, reuses `url.ts` exports)

### MCP Server

- `src/mcp/`: remote MCP server (Streamable HTTP, OAuth via tsidp) wrapping the read scripts and write modules above. See [`src/mcp/README.md`](src/mcp/README.md) for deployment.

Write verification uses the `x-callback-url` plugin's `xcall` skill.

## Testing

```bash
bun test plugins/things
```
