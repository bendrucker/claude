---
name: things:inbox
description: Quick captures to the Things 3 inbox. Not for reads (things:jxa), scheduled tasks, updates, or projects (things:url).
allowed-tools: ["Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/inbox.ts:*)"]
hooks:
  PreToolUse:
    - matcher: "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/inbox.ts:*)"
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

# Things Inbox

Add todos to the Things 3 inbox.

## Add a Todo

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/inbox.ts --session-id ${CLAUDE_SESSION_ID} title="Buy milk"
```

The script handles URL encoding, session attribution, and the `Claude` tag automatically.

When the `x-callback-url` plugin is installed, the script uses xcall to get the todo ID back from Things and outputs a `things:///show?id=...` URL. Present this URL to the user so they can click to open the todo. If xcall is unavailable, the script falls back to fire-and-forget.

## Parameters

- `title` (string) — todo title
- `titles` (newline-separated) — multiple todos
- `notes` (string, max 10,000 chars) — additional notes (session attribution appended as footer)
- `tags` (comma-separated) — extra tag names (`Claude` is always included)
- `checklist-items` (newline-separated, max 100) — checklist items

## Examples

```bash
# Simple inbox item
bun ${CLAUDE_PLUGIN_ROOT}/scripts/inbox.ts --session-id ${CLAUDE_SESSION_ID} title="Call dentist"

# With additional notes
bun ${CLAUDE_PLUGIN_ROOT}/scripts/inbox.ts --session-id ${CLAUDE_SESSION_ID} title="Review PR #456" tags=Work notes="Check error handling"

# Multiple items at once
bun ${CLAUDE_PLUGIN_ROOT}/scripts/inbox.ts --session-id ${CLAUDE_SESSION_ID} titles="Buy milk
Pick up dry cleaning
Walk dog"

# With checklist
bun ${CLAUDE_PLUGIN_ROOT}/scripts/inbox.ts --session-id ${CLAUDE_SESSION_ID} title="Prepare presentation" checklist-items="Create slides
Prepare talking points
Practice delivery"
```

## Notes Formatting

Things supports [Markdown in notes](https://culturedcode.com/things/support/articles/4651820/):

- **Headings**: `#`, `##`, `###`
- **Bold**: `**text**`
- **Code**: backticks for inline, triple backticks for blocks
- **Links**: `[title](url)`
- **Lists**: `-` or `1.`
