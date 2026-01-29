# Linear Inbox

Review issues assigned to me.

## Query

Load the `linear:linear` skill. Query issues with `assignee: "me"`.

Filter by state:
- **Todo** — Ready to start
- **In Progress** — Check for blockers

## Review

For each issue, use `AskUserQuestion`:

| Action | Description |
|--------|-------------|
| Start now | Begin working on this issue |
| Keep on radar | Leave in current state, no action needed |
| Defer to Things | Create tracking task in Things |
| Unassign | Remove self, return to backlog |

## Defer to Things

Load the `things:inbox` skill. Create task with:

- **Title**: `Linear: {identifier} - {title}`
- **Notes**: Markdown link (MCP tools return full URLs)
- **Tags**: `Linear`

Example: `Linear: ENG-123 - Implement user authentication`

## Evening Variant

Skip entirely. Linear issues are for focused work, not evening triage.
