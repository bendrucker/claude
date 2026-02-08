---
name: things:jxa
description: Read and query Things 3 data (lists, todos, projects, tags, logbook). Not for writes — use things:url to create/update, things:inbox for quick captures.
allowed-tools: ["Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/query-*:*)", "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/find-*:*)", "Bash(osascript:*)", Read]
hooks:
  PreToolUse:
    - matcher: "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/query-*:*)"
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
    - matcher: "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/find-*:*)"
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

Scripts output formatted tables by default. Pass `--json` for raw JSON output. Use `--columns` to select specific columns (comma-separated, case-insensitive, e.g. `--columns name,status`). `--columns` is ignored when `--json` is used. Path: `${CLAUDE_PLUGIN_ROOT}/scripts/`.

| Script | Usage | Description |
|--------|-------|-------------|
| `query-list.ts` | `bun <path>/query-list.ts <list-id>` | Query todos from any built-in list |
| `query-metadata.ts` | `bun <path>/query-metadata.ts projects\|areas\|tags` | List projects, areas, or tags |
| `find-todos.ts` | `bun <path>/find-todos.ts --tag "Work"` | Find todos by tag or project |
| `query-logbook.ts` | `bun <path>/query-logbook.ts --days 7` | Query logbook with date filtering |
| `export-markdown.js` | `osascript <root>/skills/jxa/scripts/export-markdown.js [list-id]` | Export a list to markdown checklist |

## Built-in List IDs

- `TMInboxListSource` — Inbox
- `TMTodayListSource` — Today
- `TMNextListSource` — Anytime
- `TMCalendarListSource` — Upcoming
- `TMSomedayListSource` — Someday
- `TMLogbookListSource` — Logbook

## Logbook Performance

The logbook can contain thousands of items sorted by completion date (most recent first). `query-logbook.ts` uses early termination — recent queries are fast, but full scans of 10k+ items take ~15-20 minutes (~70-80ms per `properties()` call).

`--days N` queries recent completions. `--start/--end` queries a date range.

## Repeating Tasks

Things doesn't expose repeating task configuration through JXA. Detect instances using the midnight heuristic: a task is a repeating instance if `creationDate` is at midnight (00:00:00 local time). Manually created tasks have non-zero hours/minutes/seconds.

Templates have `activationDate: null` and share the same `name` as their instances. See [troubleshooting.md](troubleshooting.md) for filtering examples.

## Inline JXA

For one-off queries not covered by the scripts, use `osascript -l JavaScript -e '...'` with inline code. Return JSON via `JSON.stringify(result, null, 2)`. Alternatively, use `run-jxa` in a Bun script to pass typed args and get parsed results back.

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
