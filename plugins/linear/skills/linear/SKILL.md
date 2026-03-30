---
name: linear
description: Interacting with Linear issues, projects, and teams. Use when creating issues, updating issues, querying issues, managing projects, working on tasks, discussing backlogs, or any interaction with Linear.
allowed-tools:
  - mcp__linear
  - mcp__claude_ai_Linear
  - WebFetch(domain:linear.app)
  - Bash
---

# Linear

Tools and workflows for managing issues, projects, and teams in Linear.

## Tool Selection

Choose the right tool for the task:

1. **MCP tools** - Use for simple operations (create/update/query single issues, basic filters)
2. **`linear api` CLI** - Use for complex queries, bulk operations, or anything not supported by MCP tools

## Conventions

### Issue References

When writing text that references other issues (descriptions, comments, updates), never use bare identifiers like `ENG-123`. Linear auto-renders issue URLs as inline preview components, so use the full URL:

- **Bare URL**: `https://linear.app/workspace/issue/ENG-123` (renders as an inline preview)
- **Hyperlinked text**: `[the auth bug](https://linear.app/workspace/issue/ENG-123)` (when linking specific words is more natural)

Both MCP tools and GraphQL queries return a `url` field on issues. Always include `url` when querying issues you may reference in written content.

### Issue Status

When creating issues, set the appropriate status based on assignment:

- **Assigned to me** (`assignee: "me"`): Set `state: "Todo"`
- **Unassigned**: Set `state: "Backlog"`

Example:
```typescript
// Issue for myself
await linear.create_issue({
  team: "ENG",
  title: "Fix authentication bug",
  assignee: "me",
  state: "Todo"
})

// Unassigned issue
await linear.create_issue({
  team: "ENG",
  title: "Research API performance",
  state: "Backlog"
})
```

### Querying Issues

Use `assignee: "me"` to filter issues assigned to the authenticated user:

```typescript
// My issues
await linear.list_issues({ assignee: "me" })

// Team backlog
await linear.list_issues({ team: "ENG", state: "Backlog" })
```

### Labels

You can use label names directly in `create_issue` and `update_issue` - no need to look up IDs:

```typescript
await linear.create_issue({
  team: "ENG",
  title: "Update documentation",
  labels: ["documentation", "high-priority"]
})
```

**Label Lookup**: Labels can exist at the workspace level or team level. When searching for labels, check both:

1. Workspace labels: `list_issue_labels()` (no team filter)
2. Team labels: `list_issue_labels({ team: "TEAM" })`

If a label isn't found at the workspace level, check the team before concluding it doesn't exist.

## GraphQL API

Use `linear api` for queries and mutations not supported by MCP tools. See `api.md` for full documentation.

```bash
linear api 'query { viewer { id name } }'
```

With variables:

```bash
linear api 'query($id: String!) { issue(id: $id) { title } }' --variable id=ISSUE_ID
```

Pipe output through `jq` for formatting:

```bash
linear api 'query { viewer { assignedIssues { nodes { identifier title url } } } }' | jq '.data.viewer.assignedIssues.nodes'
```

## Opening Issues in the Desktop App

Use the `linear://` URL scheme to open issues in the native Mac app instead of the browser:

```bash
# Replace https://linear.app with linear:// in any Linear URL
open "linear://team-slug/issue/ENG-123"
```

The desktop app must be installed. When given an issue identifier (e.g., `ENG-123`), construct the URL using the team's workspace slug and issue identifier.

## Reference

- Linear MCP: https://linear.app/docs/mcp.md
- GraphQL API: See `api.md`
