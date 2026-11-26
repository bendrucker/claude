---
name: things:jxa
description: Read and query Things 3 data from this machine's CLI (lists, todos, projects, tags, logbook). Prefer the things MCP tools, which reach the same reads from any machine. Use this skill when that server is unreachable.
allowed-tools:
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/format-output.ts:*)"
  - "Skill(mac:jxa-run)"
  - "Skill(mac:jxa-run Things3:*)"
  - Read
---

# Things JXA

## Running JXA

Run every JXA script and expression through the `mac:jxa-run` skill, which validates the `Application("Things3")` scope and runs outside the sandbox.

- Script: `Skill(mac:jxa-run, args: "Things3 ${CLAUDE_PLUGIN_ROOT}/scripts/jxa/query-list.js TMTodayListSource")`
- Expression: `Skill(mac:jxa-run, args: "Things3 -e 'var app = Application(\"Things3\"); JSON.stringify(app.lists.byId(\"TMTodayListSource\").toDos().length)'")`

For a table, pipe the returned JSON through `echo '<json>' | bun ${CLAUDE_PLUGIN_ROOT}/scripts/format-output.ts [--json] [--columns name,status]`.

When Things is not running (`Error: Application can't be found.`), launch it with `open -g -a "Things3"`.

## Scripts

In `${CLAUDE_PLUGIN_ROOT}/scripts/jxa/` unless noted:

| Script | Usage | Description |
|--------|-------|-------------|
| `find-todos.js` | `<tag\|project> <name> [--logbook]` | Todos by tag (across Inbox/Today/Anytime/Upcoming/Someday) or project |
| `search-todos.js` | `<text> [--field name\|notes\|both] [--limit <n>]` | Text search with notes previews |
| `get-todo.js` | `<id>` | Full detail for one todo (no checklist items) |
| `query-list.js` | `<list-id>` | Todos in a built-in list |
| `query-logbook.js` | `<start-iso> <end-iso> [--notes-contains <substring>]` | Logbook in a date range, with early termination. `--notes-contains` adds `notes` to the output (e.g. to find `Discovery:` markers) |
| `query-metadata.js` | `<projects\|areas\|tags>` | Projects, areas, or tags (tags omit `todoCount`) |
| `export-markdown.js` | `[list-id]` | A list as a markdown checklist. Lives in `${CLAUDE_SKILL_DIR}/scripts/` |

Bound logbook reads by date. A full scan covers 10k+ items.

## Built-in List IDs

`TMInboxListSource` (Inbox), `TMTodayListSource` (Today), `TMNextListSource` (Anytime), `TMCalendarListSource` (Upcoming), `TMSomedayListSource` (Someday), `TMLogbookListSource` (Logbook)

## Reference

- [jxa.md](jxa.md): object model, syntax quirks, and status values, for writing an inline expression
- [setup.md](setup.md): script structure and type definitions, for writing a new script
- [troubleshooting.md](troubleshooting.md): sandbox errors, URL-scheme update failures, error messages, and repeating-task detection (a repeating instance has `creationDate` at local midnight)
