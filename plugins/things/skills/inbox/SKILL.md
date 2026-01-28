---
name: inbox
description: Quick fire-and-forget captures to the Things 3 inbox. Not for reads (things:jxa), scheduled tasks, updates, or projects (things:url).
allowed-tools: [Bash(open:*)]
hooks:
  PreToolUse:
    - matcher: "Bash(open:*)"
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

Add todos to the Things 3 inbox. Fire-and-forget — no verification needed for quick captures.

## Add a Todo

```bash
open -g "things:///add?title=Buy%20milk"
```

The `-g` flag runs in the background without foregrounding Things.

## Parameters

- `title` (string) — todo title (URL-encoded)
- `titles` (newline-separated) — multiple todos (`%0a` separator)
- `notes` (string, max 10,000 chars) — todo notes
- `tags` (comma-separated) — tag names
- `checklist-items` (newline-separated, max 100) — checklist items
- `when` — omit to land in inbox (default), or use `today`, `tomorrow`, `evening`
- `deadline` — due date in `yyyy-mm-dd` format

No auth token is required for `add`.

## Examples

```bash
# Simple inbox item
open -g "things:///add?title=Call%20dentist"

# With notes and tags
open -g "things:///add?title=Review%20PR%20%23456&notes=Check%20error%20handling&tags=Work"

# Multiple items at once
open -g "things:///add?titles=Buy%20milk%0aPick%20up%20dry%20cleaning%0aWalk%20dog"

# With checklist
open -g "things:///add?title=Prepare%20presentation&checklist-items=Create%20slides%0aPrepare%20talking%20points%0aPractice%20delivery"
```

## Notes Formatting

Things supports [Markdown in notes](https://culturedcode.com/things/support/articles/4651820/):

- **Headings**: `#`, `##`, `###`
- **Bold**: `**text**`
- **Code**: backticks for inline, triple backticks for blocks
- **Links**: `[title](url)`
- **Lists**: `-` or `1.`

## URL Encoding

All parameters must be URL-encoded:
- Space → `%20`
- Newline → `%0a`
- `&` → `%26`
- `#` → `%23`
