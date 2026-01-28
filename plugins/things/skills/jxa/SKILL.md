---
name: jxa
description: Read and query Things 3 data (lists, todos, projects, tags, logbook). Not for writes — use things:url to create/update, things:inbox for quick captures.
allowed-tools: [Bash(osascript:*), Read]
hooks:
  PreToolUse:
    - matcher: "Bash(osascript:*)"
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

# Things JXA

Read and query Things 3 data via JXA (JavaScript for Automation).

## Scripts

All scripts output JSON (except `export-markdown.js` which outputs markdown). Path: `${CLAUDE_PLUGIN_ROOT}/skills/jxa/scripts/`.

| Script | Usage | Description |
|--------|-------|-------------|
| `query-list.js` | `osascript <path>/query-list.js <list-id>` | Query todos from any built-in list |
| `query-metadata.js` | `osascript <path>/query-metadata.js projects\|areas\|tags` | List projects, areas, or tags |
| `find-todos.js` | `osascript <path>/find-todos.js --tag "Work"` | Find todos by tag or project |
| `export-markdown.js` | `osascript <path>/export-markdown.js [list-id]` | Export a list to markdown |
| `query-logbook.js` | `osascript <path>/query-logbook.js --days 7` | Query logbook with date filtering |

## Built-in List IDs

- `TMInboxListSource` — Inbox
- `TMTodayListSource` — Today
- `TMNextListSource` — Anytime
- `TMCalendarListSource` — Upcoming
- `TMSomedayListSource` — Someday
- `TMLogbookListSource` — Logbook

## Logbook Performance

The logbook can contain thousands of items sorted by completion date (most recent first). `query-logbook.js` uses early termination — recent queries are fast, but full scans of 10k+ items take ~15-20 minutes (~70-80ms per `properties()` call).

`--days N` queries recent completions. `--start/--end` queries a date range.

## Repeating Tasks

Things doesn't expose repeating task configuration through JXA. Detect instances using the midnight heuristic: a task is a repeating instance if `creationDate` is at midnight (00:00:00 local time). Manually created tasks have non-zero hours/minutes/seconds.

Templates have `activationDate: null` and share the same `name` as their instances. See [troubleshooting.md](troubleshooting.md) for filtering examples.

## Inline JXA

For one-off queries not covered by the scripts, use `osascript -l JavaScript -e '...'` with inline code. Return JSON via `JSON.stringify(result, null, 2)`.

**JXA arrays** (from `list.toDos()`, `app.projects()`, etc.) have `.length` and `[i]` but may lack `.map()/.filter()`. Use for-loops or `Array.from()`.

## Status Values

`open`, `completed`, `canceled` — compare with `todo.status().toString()`.

## Documentation

- **[jxa.md](jxa.md)** — Complete JXA object model and API reference
- **[setup.md](setup.md)** — TypeScript/JXA development setup, array conversion
- **[troubleshooting.md](troubleshooting.md)** — Common issues, sandbox errors, best practices

## Tips

- **Optional chaining**: Use `todo.project()?.name()` for nullable properties
- **Batch reads**: Use `properties()` to fetch all properties at once instead of individual getters
- **Launch Things first**: `open -g -a "Things3"` if not running
