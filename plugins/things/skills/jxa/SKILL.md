---
name: things:jxa
description: Read and query Things 3 data (lists, todos, projects, tags, logbook). Not for writes — use things:url to create/update, things:inbox for quick captures.
allowed-tools:
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/run-jxa.ts Things3:*)"
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/format-output.ts:*)"
  - Read
hooks:
  PreToolUse:
    - matcher: "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/run-jxa.ts Things3:*)|Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/format-output.ts:*)"
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

Read and query Things 3 data via JXA. Queries use a pipeline: `bun <root>/scripts/run-jxa.ts Things3 <root>/scripts/jxa/<script> <args> | bun <root>/scripts/format-output.ts [--json] [--columns name,status] [--count-prefix "completed items"]`

`<root>` is `${CLAUDE_PLUGIN_ROOT}`.

## Scripts

| Script | Usage | Description |
|--------|-------|-------------|
| `find-todos.js` | `<tag\|project> <name> [--logbook]` | Find todos by tag (across Inbox/Today/Anytime/Upcoming/Someday) or project |
| `query-list.js` | `<list-id>` | Query todos from any built-in list |
| `query-logbook.js` | `<start-iso> <end-iso>` | Query logbook with early termination. Full scans of 10k+ items are slow. |
| `query-metadata.js` | `<projects\|areas\|tags>` | List projects, areas, or tags (tags omit todoCount for performance) |
| `export-markdown.js` | `bun <root>/scripts/run-jxa.ts Things3 <root>/skills/jxa/scripts/export-markdown.js [list-id]` | Export a list to markdown checklist |

### query-logbook.js

Compute ISO dates in the shell:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/run-jxa.ts Things3 ${CLAUDE_PLUGIN_ROOT}/scripts/jxa/query-logbook.js "$(date -v-7d -u +%Y-%m-%dT%H:%M:%SZ)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | bun ${CLAUDE_PLUGIN_ROOT}/scripts/format-output.ts --count-prefix "completed items"
```

## Built-in List IDs

`TMInboxListSource` (Inbox), `TMTodayListSource` (Today), `TMNextListSource` (Anytime), `TMCalendarListSource` (Upcoming), `TMSomedayListSource` (Someday), `TMLogbookListSource` (Logbook)

## Repeating Tasks

Detect via midnight heuristic: `creationDate` at `T00:00:00` local time = repeating instance. Templates have `activationDate: null`. See [troubleshooting.md](troubleshooting.md) for examples.

## Inline JXA

For one-off queries: `bun ${CLAUDE_PLUGIN_ROOT}/scripts/run-jxa.ts Things3 -e '...'`. JXA arrays lack `.map()/.filter()` — use for-loops.

## Status Values

`open`, `completed`, `canceled`

## Reference

- [jxa.md](jxa.md) — Object model and API
- [setup.md](setup.md) — Development setup
- [troubleshooting.md](troubleshooting.md) — Common issues

## Tips

- Use `properties()` for batch reads instead of individual getters
- `open -g -a "Things3"` to launch Things if not running
