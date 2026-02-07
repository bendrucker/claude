---
name: url
description: Create, update, and manage Things 3 tasks and projects. Not for reads — use things:jxa to query data. For simple inbox captures, use things:inbox.
allowed-tools: ["Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/url.ts:*)", Bash(osascript:*), Bash(open:*), Bash, Read]
hooks:
  PreToolUse:
    - matcher: "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/url.ts:*)|Bash(osascript:*)|Bash(open:*)"
      hooks:
        - type: command
          command: |
            jq -n '{
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "allow",
                updatedInput: { dangerouslyDisableSandbox: true }
              }
            }'
---

# Things URL Scheme

Write operations for Things 3 via the `things:///` URL scheme.

## Quick Start

Use `url.ts` for most operations — it handles auth tokens and URL encoding:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/url.ts <command> [key=value ...]

# Bulk update: pass multiple id= params to batch via JSON command
bun ${CLAUDE_PLUGIN_ROOT}/scripts/url.ts update id=X id=Y id=Z when=tomorrow
```

For raw URL scheme access: `open -g "things:///add?title=Buy%20milk&when=today"`

Use `-g` for data commands (add, update, json) to run in background. Omit `-g` for `show`/`search` to foreground Things.

## Commands

| Command | Description | Auth required |
|---------|-------------|:---:|
| `add` | Create a todo | No |
| `add-project` | Create a project with optional todos | No |
| `update` | Modify a todo's properties | Yes |
| `update-project` | Modify a project's properties | Yes |
| `show` | Navigate to a list, todo, or project | No |
| `search` | Open search with optional query | No |
| `json` | Batch create/update via JSON payload | Yes (for updates) |

See [examples.md](examples.md) for detailed usage of each command.

## Reorder Items

```bash
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/reorder.js [--list today|anytime|someday] <id1> <id2> <id3> ...
```

Items appear at the top of the list in the order specified. Default list is `today`. Also works for items within a project — use the `--list` value matching the items' current scheduling state.

## Callback

When the `x-callback-url` plugin is installed, `url.ts` automatically uses xcall to get a response from Things on stdout. Present the result to the user as clickable `things:///show?id=<id>` links:

- **Single todo** (`add`, `update`): returns `x-things-id=<id>` — present one link
- **Batch** (`json`): returns `x-things-ids=["id1","id2"]` — present a bulleted list with each todo's title and link

Callback is enabled by default. Disable with `--callback=false` to fall back to fire-and-forget via `open -g`. If xcall is unavailable, the script falls back silently.

## Built-in List IDs (URL Scheme)

For `show` command: `inbox`, `today`, `anytime`, `upcoming`, `someday`, `logbook`, `tomorrow`, `deadlines`, `repeating`, `all-projects`, `logged-projects`

## Lookup Area IDs

The `list` parameter only works with project names. For areas, use `list-id` with the area UUID (query area IDs via the `things:jxa` skill).

## When Values

- `today`, `tomorrow`, `evening`
- `anytime`, `someday`
- `yyyy-mm-dd` (specific date)
- Natural language: "in 3 days", "next week"

## Notes Formatting

Things supports [Markdown in notes](https://culturedcode.com/things/support/articles/4651820/):

- **Headings**: `#`, `##`, `###`
- **Bold**: `**text**`
- **Highlights**: `::text::`
- **Code**: backticks for inline, triple backticks for blocks
- **Links**: `[title](url)`
- **Lists**: `-` or `1.`

## Documentation

- **[examples.md](examples.md)** — Detailed usage examples for all commands
- **[url-scheme.md](url-scheme.md)** — Complete URL scheme commands and parameters
- **[1password.md](1password.md)** — Auth token setup and keychain configuration

## Tips

- **Moving out of inbox**: Set `when=anytime` to move a todo out of inbox without assigning an area
- **Moving to area**: Use `list-id` with the area UUID (not `area-id`)
- **Rate limiting**: Max 250 operations per 10 seconds. For 3+ items, use multi-ID syntax (`id=X id=Y id=Z`) to batch into a single JSON command instead of individual calls.
- **Repeating todos**: Cannot update `when` or `deadline` on repeating to-dos
