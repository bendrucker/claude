---
name: things
description: Interacting with Things 3 task manager for Mac. Use when working with the user's personal todos, tasks, projects, areas, tags, or task lists (inbox, today, upcoming, etc.). Supports creating, reading, updating, and navigating tasks.
allowed-tools: [Bash(osascript:*), Bash(open:*), Read]
---

# Things 3 Task Manager

Interact with Things 3, the user's personal task manager for Mac.

## Quick Start

**Read operations**: Use TypeScript with esbuild to write type-safe JXA code via `scripts/run-jxa.sh`
**Write operations**: Use `osascript scripts/url.js` which handles auth tokens and URL encoding automatically

## Common Commands

**Read today's todos:**
```bash
scripts/run-jxa.sh 'const app = Application("Things3"); const today = app.lists.byId("TMTodayListSource"); JSON.stringify(today.toDos().map(t => ({id: t.id(), name: t.name()})), null, 2);'
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

## Essential Tips

- **Verification**: ALWAYS verify updates succeeded by reading back the todo with JXA
- **Repeating tasks**: Filter by comparing `creationDate` to midnight (see [troubleshooting.md](troubleshooting.md))
- **TypeScript mode**: Use `scripts/run-jxa.sh` for type-safe JXA with autocomplete
- **Moving out of inbox**: Set `when=anytime` to move a todo out of inbox without assigning an area
- **Raw URL scheme**: For edge cases not covered by `url.js`, use `open "things:///..."` directly (see [url-scheme.md](url-scheme.md))
