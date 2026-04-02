---
name: things:jxa
description: Read and query Things 3 data (lists, todos, projects, tags, logbook). Not for writes. Use things:url to create/update, things:inbox for quick captures.
allowed-tools:
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/format-output.ts:*)"
  - "Skill(mac:jxa-run)"
  - "Skill(mac:jxa-run Things3:*)"
  - Read
---

# Things JXA

Read and query Things 3 data via JXA.

## Running JXA

To run JXA, use the Skill tool to invoke `mac:jxa-run`. Do NOT run `bun` or `osascript` directly.

#### Script file

Invoke via: `Skill(mac:jxa-run, args: "Things3 ${CLAUDE_PLUGIN_ROOT}/scripts/jxa/query-list.js TMTodayListSource")`

#### Inline expression

Invoke via: `Skill(mac:jxa-run, args: "Things3 -e 'var app = Application(\"Things3\"); JSON.stringify(app.lists.byId(\"TMTodayListSource\").toDos().length)'")`

#### Formatting output

Pipe the returned JSON through the formatter for table display:

```bash
echo '<json>' | bun ${CLAUDE_PLUGIN_ROOT}/scripts/format-output.ts [--json] [--columns name,status]
```

## Scripts

| Script | Usage | Description |
|--------|-------|-------------|
| `find-todos.js` | `<tag\|project> <name> [--logbook]` | Find todos by tag (across Inbox/Today/Anytime/Upcoming/Someday) or project |
| `query-list.js` | `<list-id>` | Query todos from any built-in list |
| `query-logbook.js` | `<start-iso> <end-iso>` | Query logbook with early termination. Full scans of 10k+ items are slow. |
| `query-metadata.js` | `<projects\|areas\|tags>` | List projects, areas, or tags (tags omit todoCount for performance) |
| `export-markdown.js` | `[list-id]` | Export a list to markdown checklist |

## Built-in List IDs

`TMInboxListSource` (Inbox), `TMTodayListSource` (Today), `TMNextListSource` (Anytime), `TMCalendarListSource` (Upcoming), `TMSomedayListSource` (Someday), `TMLogbookListSource` (Logbook)

## Repeating Tasks

Detect via midnight heuristic: `creationDate` at `T00:00:00` local time = repeating instance. Templates have `activationDate: null`. See [troubleshooting.md](troubleshooting.md) for examples.

## Status Values

`open`, `completed`, `canceled`

## Reference

- [jxa.md](jxa.md): Object model and API
- [setup.md](setup.md): Development setup
- [troubleshooting.md](troubleshooting.md): Common issues

## Tips

- Use `properties()` for batch reads instead of individual getters
- `open -g -a "Things3"` to launch Things if not running
