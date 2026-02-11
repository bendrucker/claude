---
name: reminders
description: Apple Reminders integration — read and manage the inbox. Use when the user wants to check reminders or work with Reminders.app.
---

# Reminders

Read and manage Apple Reminders via JXA (`osascript -l JavaScript`).

## Scripts

| Script | Description |
|--------|-------------|
| `${CLAUDE_PLUGIN_ROOT}/scripts/jxa/read-default-list.js` | Read incomplete reminders from the default list |
| `${CLAUDE_PLUGIN_ROOT}/scripts/jxa/delete-reminders.js` | Delete reminders by ID (pass IDs as arguments) |

## Notes

- Launch Reminders first if not running: `open -g -a "Reminders"`
- JXA arrays from Reminders lack `.map()/.filter()` — use for-loops
- `.whose()` works for filtering reminders by `completed` status
- The default list is where Siri dictation creates items
