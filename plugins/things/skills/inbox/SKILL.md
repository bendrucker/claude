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
open -g "things:///add?title=Buy%20milk&tags=Claude&notes=Claude%20Session%20ID%3A%20$CLAUDE_SESSION_ID%0a%0a%60%60%60sh%0aclaude%20--resume%20$CLAUDE_SESSION_ID%0a%60%60%60"
```

The `-g` flag runs in the background without foregrounding Things.

## Required Attribution

**Always include these parameters:**

1. `tags=Claude` — tag for filtering Claude-created todos
2. `notes` must start with session attribution:
   ```
   Claude Session ID: <id>

   ```sh
   claude --resume <id>
   ```
   ```

The session ID is available via `$CLAUDE_SESSION_ID`. Append any additional notes after the attribution block.

## Parameters

- `title` (string) — todo title (URL-encoded)
- `titles` (newline-separated) — multiple todos (`%0a` separator)
- `notes` (string, max 10,000 chars) — todo notes (must include attribution)
- `tags` (comma-separated) — tag names (must include `Claude`)
- `checklist-items` (newline-separated, max 100) — checklist items
- `when` — omit to land in inbox (default), or use `today`, `tomorrow`, `evening`
- `deadline` — due date in `yyyy-mm-dd` format

No auth token is required for `add`.

## Examples

```bash
# Simple inbox item
open -g "things:///add?title=Call%20dentist&tags=Claude&notes=Claude%20Session%20ID%3A%20$CLAUDE_SESSION_ID%0a%0a%60%60%60sh%0aclaude%20--resume%20$CLAUDE_SESSION_ID%0a%60%60%60"

# With additional notes
open -g "things:///add?title=Review%20PR%20%23456&tags=Claude,Work&notes=Claude%20Session%20ID%3A%20$CLAUDE_SESSION_ID%0a%0a%60%60%60sh%0aclaude%20--resume%20$CLAUDE_SESSION_ID%0a%60%60%60%0a%0aCheck%20error%20handling"

# Multiple items at once (each gets same attribution)
open -g "things:///add?titles=Buy%20milk%0aPick%20up%20dry%20cleaning%0aWalk%20dog&tags=Claude&notes=Claude%20Session%20ID%3A%20$CLAUDE_SESSION_ID%0a%0a%60%60%60sh%0aclaude%20--resume%20$CLAUDE_SESSION_ID%0a%60%60%60"

# With checklist
open -g "things:///add?title=Prepare%20presentation&tags=Claude&notes=Claude%20Session%20ID%3A%20$CLAUDE_SESSION_ID%0a%0a%60%60%60sh%0aclaude%20--resume%20$CLAUDE_SESSION_ID%0a%60%60%60&checklist-items=Create%20slides%0aPrepare%20talking%20points%0aPractice%20delivery"
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
