---
name: things
description: Interacting with Things 3 task manager for Mac. Use when working with the user's personal todos, tasks, projects, areas, tags, or task lists (inbox, today, upcoming, etc.). Supports creating, reading, updating, and navigating tasks.
allowed-tools: [Bash(osascript:*), Bash(open:*), Read]
hooks:
  PreToolUse:
    - matcher: "Bash(osascript:*)|Bash(open:*)"
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

# Things 3 Task Manager

Interact with Things 3, the user's personal task manager for Mac.

## Quick Start

**Read operations**: Use `osascript -l JavaScript -e '...'` for inline JXA
**Write operations**: Use `osascript scripts/url.js` which handles auth tokens and URL encoding automatically

## Common Commands

**Read today's todos:**
```bash
osascript -l JavaScript -e 'const app = Application("Things3"); const today = app.lists.byId("TMTodayListSource"); JSON.stringify(today.toDos().map(t => ({id: t.id(), name: t.name()})), null, 2);'
```

**Create a todo:**
```bash
osascript scripts/url.js add title="Task name" when=today tags=Work
```

**Update a todo:**
```bash
osascript scripts/url.js update id=ABC-123 append-notes="Additional info"
```

**Navigate to today:**
```bash
osascript scripts/url.js show id=today
```

**Reorder a list or project items:**
```bash
osascript scripts/reorder.js [--list today|anytime|someday] <id1> <id2> <id3> ...
```
Items appear at the top of the list in the order specified. Default list is `today`. Also works for items within a project - use the `--list` value matching the items' current scheduling state.

## Built-in List IDs

- `TMInboxListSource` - Inbox
- `TMTodayListSource` - Today
- `TMNextListSource` - Anytime
- `TMCalendarListSource` - Upcoming
- `TMSomedayListSource` - Someday
- `TMLogbookListSource` - Logbook

## Lookup Area IDs

The `list` parameter only works with project names. For areas, use `list-id` with the area UUID:
```bash
osascript -l JavaScript -e 'const app = Application("Things3"); JSON.stringify(app.areas().map(a => ({name: a.name(), id: a.id()})), null, 2);'
```

## When Values

- `today`, `tomorrow`, `evening`
- `anytime`, `someday`
- `yyyy-mm-dd` (specific date)
- Natural language: "in 3 days", "next week"

## Status Values (JXA)

- `open` - Active todo
- `completed` - Completed
- `canceled` - Canceled

## Documentation

Load detailed guides as needed:

- **[setup.md](setup.md)** - TypeScript/JXA development setup, array conversion, running scripts
- **[examples.md](examples.md)** - Comprehensive usage examples for all operations
- **[jxa.md](jxa.md)** - Complete JXA object model and API reference
- **[url-scheme.md](url-scheme.md)** - URL scheme commands and parameters
- **[1password.md](1password.md)** - Auth token setup and keychain configuration
- **[troubleshooting.md](troubleshooting.md)** - Common issues, best practices, repeating task detection
- **[daily-review.md](daily-review.md)** - Interactive daily review workflow for inbox, today, and priorities

## Notes Formatting

Things supports [Markdown in notes](https://culturedcode.com/things/support/articles/4651820/). Use formatting for readability:

- **Headings**: Use `#`, `##`, `###` at line start
- **Bold**: Use `**text**` for emphasis
- **Highlights**: Use `::text::` for highlighted text
- **Code blocks**: Wrap commands or code in triple backticks
- **Inline code**: Use backticks for `identifiers`, `file paths`, `commands`
- **Links**: Use `[title](url)` for clickable links
- **Lists**: Use `-` or `1.` for bulleted/numbered lists

## Essential Tips

- **Verification**: ALWAYS verify updates succeeded by reading back the todo with JXA
- **Repeating tasks**: Filter by comparing `creationDate` to midnight (see [troubleshooting.md](troubleshooting.md))
- **Moving out of inbox**: Set `when=anytime` to move a todo out of inbox without assigning an area
- **Raw URL scheme**: For edge cases not covered by `url.js`, use `open "things:///..."` directly (see [url-scheme.md](url-scheme.md)). Use `-g` for data commands (add, update, json) to run in background; omit `-g` for `show`/`search` to foreground Things.
- **Type reference**: See [jxa.md](jxa.md) for the complete Things3 JXA API
