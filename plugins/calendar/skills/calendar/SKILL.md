---
name: calendar
description: Reading and managing macOS Calendar events. Use when checking schedules, finding events, creating meetings, or answering questions about availability.
allowed-tools: [Bash(swift:*)]
hooks:
  PreToolUse:
    - matcher: "Bash(swift:*)"
      hooks:
        - type: command
          command: |
            cat | jq '
              # EventKit requires system access — disable sandbox for all commands
              if (.tool_input.command | test("cal\\.swift\\s+(calendars|list|get)\\b"))
              # Auto-allow read operations
              then {hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: {dangerouslyDisableSandbox: true}}}
              # Prompt before mutating calendar data
              else {hookSpecificOutput: {hookEventName: "PreToolUse", updatedInput: {dangerouslyDisableSandbox: true}}}
              end'
---

# macOS Calendar

Interact with Calendar.app using a Swift CLI that wraps EventKit.

The CLI lives at `@skills/calendar/scripts/cal.swift` and is invoked via `swift <path> <command> [options]`. It uses EventKit's native date range predicates for efficient queries and returns JSON.

## Setup

Calendar access must be granted to the terminal app (Ghostty, Terminal.app, etc.) in **System Settings → Privacy & Security → Calendars**.

Over SSH, EventKit permissions don't apply. Use a local terminal session.

## Read Operations

**List calendars:**
```bash
timeout 5 swift @scripts/cal.swift calendars
```

Returns `id`, `name`, `writable`, and `source` (Google, iCloud, etc.) for each calendar. Use `id` or `name` to filter in other commands.

**List events in a date range:**
```bash
timeout 5 swift @scripts/cal.swift list --start 2026-01-27 --end 2026-01-28
```

**Filter by calendar (by name or ID):**
```bash
timeout 5 swift @scripts/cal.swift list --start 2026-01-27 --end 2026-02-03 --calendar Rides
```

**Get event details by ID:**
```bash
timeout 5 swift @scripts/cal.swift get "EVENT_ID"
```

## Write Operations

**Create event:**
```bash
timeout 5 swift @scripts/cal.swift create \
  --title "Team Meeting" \
  --start "2026-01-28 14:00" \
  --end "2026-01-28 15:00" \
  --calendar Personal \
  --location "Conference Room" \
  --notes "Weekly sync"
```

**Create all-day event:**
```bash
timeout 5 swift @scripts/cal.swift create \
  --title "Conference" \
  --start 2026-02-01 \
  --end 2026-02-02 \
  --allDay true
```

**Update event:**
```bash
timeout 5 swift @scripts/cal.swift update "EVENT_ID" \
  --title "Updated Title" \
  --location "New Room"
```

**Delete event:**
```bash
timeout 5 swift @scripts/cal.swift delete "EVENT_ID"
```

## Event JSON Format

All commands return JSON with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | EventKit identifier (use for get/update/delete) |
| `summary` | string | Event title |
| `start` | string | ISO 8601 start time |
| `end` | string | ISO 8601 end time |
| `allDay` | boolean | All-day event flag |
| `calendar` | string | Calendar name |
| `location` | string | Event location (if set) |
| `notes` | string | Event notes (if set) |
| `attendees` | string[] | Attendee names (if any) |

## Date Formats

The CLI accepts:
- `YYYY-MM-DD` — date only (for all-day events or date range queries)
- `YYYY-MM-DD HH:MM` — date and time (local timezone)
- ISO 8601 — `2026-01-28T14:00:00Z`

## Calendar Selection

When creating events with `--calendar`, the CLI tries:
1. Exact calendar ID match
2. Calendar name match (first writable match if duplicates exist)

For calendars with duplicate names (e.g., "Personal" on both Google and iCloud), use the calendar ID from the `calendars` command.

## Troubleshooting

**"Calendar access denied"**: Grant access in System Settings → Privacy & Security → Calendars for your terminal app.

**"Event not found"**: Event IDs are EventKit identifiers returned by `list` and `create`. IDs from other tools (icalBuddy, JXA) are incompatible.

**Times are in UTC**: EventKit returns ISO 8601 in UTC. Convert to local time as needed.
