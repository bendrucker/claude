---
name: url
description: Things 3 URL scheme operations for creating, updating, and managing tasks and projects. Use for write operations including add, update, json, show, and search commands.
allowed-tools: [Bash(osascript:*), Bash(open:*), Bash, Read]
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

# Things URL Scheme

Write operations for Things 3 via the `things:///` URL scheme.

## Quick Start

Use the `url.js` wrapper for most operations — it handles auth tokens and URL encoding:

```bash
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js add title="Buy milk" when=today
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js update id=ABC-123 append-notes="Done!"
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js show id=today
```

For raw URL scheme access:

```bash
open -g "things:///add?title=Buy%20milk&when=today"
```

Use `-g` for data commands (add, update, json) to run in background. Omit `-g` for `show`/`search` to foreground Things.

## Commands

### Create Todos

```bash
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js add title="Task name" when=today tags=Work
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js add title="Full details" notes="Review goals" when=2025-11-01 deadline=2025-11-07 tags=Work,Planning
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js add titles="Buy milk
Pick up dry cleaning
Walk dog" when=today
```

### Create with Checklist (JSON)

```bash
data='[{
  "type": "to-do",
  "attributes": {
    "title": "Prepare presentation",
    "when": "today",
    "tags": ["Work"],
    "checklist-items": [
      {"type": "checklist-item", "attributes": {"title": "Create slides"}},
      {"type": "checklist-item", "attributes": {"title": "Prepare talking points"}}
    ]
  }
}]'
open -g "things:///json?data=$(echo "$data" | jq -sRr @uri)"
```

### Create in Project

```bash
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js add title="Write chapter 3" list="Book Writing" when=anytime
```

### Create Projects

```bash
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js add-project title="Website Redesign" when=today tags=Work
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js add-project title="Plan vacation" when=tomorrow to-dos="Research destinations
Book flights
Book hotel"
```

### Complex Projects (JSON)

```bash
data='[{
  "type": "project",
  "attributes": {
    "title": "Launch New Feature",
    "when": "today",
    "deadline": "2025-11-30",
    "tags": ["Work"],
    "area": "Engineering",
    "items": [
      {"type": "heading", "attributes": {"title": "Planning"}},
      {"type": "to-do", "attributes": {"title": "Write spec"}},
      {"type": "to-do", "attributes": {"title": "Review with team"}},
      {"type": "heading", "attributes": {"title": "Implementation"}},
      {"type": "to-do", "attributes": {"title": "Build backend"}},
      {"type": "to-do", "attributes": {"title": "Build frontend"}}
    ]
  }
}]'
open -g "things:///json?data=$(echo "$data" | jq -sRr @uri)"
```

### Update Todos

Auth token is fetched automatically by `url.js` (see [1password.md](1password.md) for setup).

```bash
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js update id=ABC-123 append-notes="Additional info"
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js update id=ABC-123 add-tags=Urgent,Important
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js update id=ABC-123 when=tomorrow
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js update id=ABC-123 completed=true
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js update id=ABC-123 list="New Project"
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js update id=ABC-123 append-checklist-items="Item 1
Item 2"
```

### Navigate and Search

```bash
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js show id=today
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js show id=inbox
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js show id=ABC-123
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js search query="meeting notes"
```

### Reorder Items

```bash
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/reorder.js <id1> <id2> <id3> ...
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/reorder.js --list anytime <id1> <id2> <id3>
```

Items appear at the top of the list in the order specified. Default list is `today`. Also works for items within a project — use the `--list` value matching the items' current scheduling state.

### Link Tasks

```bash
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js add title="Follow up: Review proposal" notes="Original task: things:///show?id=ABC-123" when=tomorrow
osascript ${CLAUDE_PLUGIN_ROOT}/scripts/url.js update id=ABC-123 append-notes="Related: things:///show?id=DEF-456"
```

## Verification with xcall

Things supports [x-callback-url](https://culturedcode.com/things/support/articles/2803573/): all commands accept `x-success`, `x-error`, and `x-cancel` callbacks. On success, Things returns `x-things-id` (or `x-things-ids` for the `json` command).

Load the `x-callback-url:xcall` skill for the `xcall` CLI bridge. It sends the URL with callbacks and blocks until Things responds, outputting the result to stdout.

```bash
# xcall run.sh path comes from the x-callback-url plugin
xcall_run="${CLAUDE_PLUGIN_ROOT}/../x-callback-url/scripts/run.sh"

$xcall_run "things:///add?title=Buy%20milk"
# stdout: x-things-id=<id>
```

Use xcall when you need confirmation that an operation succeeded, especially for updates:

```bash
$xcall_run \
  "things:///update?id=ABC-123&auth-token=$(security find-generic-password -a "$USER" -s "things-auth-token" -w)&completed=true"
# stdout: x-things-id=ABC-123 (confirms update applied)
```

This eliminates the need for JXA read-back verification after URL scheme operations.

## Built-in List IDs (URL Scheme)

For `show` command: `inbox`, `today`, `anytime`, `upcoming`, `someday`, `logbook`, `tomorrow`, `deadlines`, `repeating`, `all-projects`, `logged-projects`

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

## Notes Formatting

Things supports [Markdown in notes](https://culturedcode.com/things/support/articles/4651820/):

- **Headings**: `#`, `##`, `###`
- **Bold**: `**text**`
- **Highlights**: `::text::`
- **Code**: backticks for inline, triple backticks for blocks
- **Links**: `[title](url)`
- **Lists**: `-` or `1.`

## Documentation

Load detailed guides as needed:

- **[url-scheme.md](url-scheme.md)** — Complete URL scheme commands and parameters
- **[1password.md](1password.md)** — Auth token setup and keychain configuration

## Tips

- **Moving out of inbox**: Set `when=anytime` to move a todo out of inbox without assigning an area
- **Moving to area**: Use `list-id` with the area UUID (not `area-id`)
- **Rate limiting**: Max 250 operations per 10 seconds. Add `sleep 0.1` between batch operations.
- **Repeating todos**: Cannot update `when` or `deadline` on repeating to-dos
