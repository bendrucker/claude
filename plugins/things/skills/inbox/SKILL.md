---
name: things:inbox
description: Quick captures to the Things 3 inbox. Not for reads (things:jxa), scheduled tasks, updates, or projects (things:url).
argument-hint: "<text>"
allowed-tools: ["Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/inbox.ts:*)"]
---

# Things Inbox

Add todos to the Things 3 inbox.

## Arguments

`$ARGUMENTS` is the capture text, passed as `title`. Multiple lines become multiple todos via `titles`. See [Add a Todo](#add-a-todo).

## Add a Todo

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/inbox.ts --session-id ${CLAUDE_SESSION_ID} title="Buy milk"
```

The script handles URL encoding, session attribution, and the `Claude` tag. Add extra tags via the `--tag` flag (repeatable): `--tag claude-code` adds the `claude-code` tag to all captured todos. Multiple tags: `--tag foo --tag bar`.

The script always prints a confirmation to stdout on success. When the `x-callback-url` plugin is installed, xcall returns the todo ID and the script outputs `https://things.bendrucker.me/show?id=...`. Present this URL to the user so they can click to open the todo. Without xcall (or when xcall succeeds but returns no ID), the script prints `captured: <title>`. No stdout output means the call failed; read stderr and surface the cause to the user rather than retrying.

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

## Gotchas

#### Never retry on silent output

The script always prints to stdout on success. If you see no output, the call failed. Read stderr, surface the cause to the user, and only retry once the root cause is understood. Silent retries have created duplicate todos.

#### Sandbox-blocked URL handoff

If stderr mentions `procNotFound`, `-10810`, or `LSOpenURLsWithRole`, the macOS sandbox blocked the URL handoff to Things. Launch Services handoff is covered by `sandbox.allowAppleEvents` in `user/settings.json`. If this still happens, verify that key is set rather than disabling the sandbox manually.
