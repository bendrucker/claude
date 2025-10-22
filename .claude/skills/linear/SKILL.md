---
name: linear
description: Managing Linear issues, projects, and teams. Use when working with Linear tasks, creating issues, updating status, querying projects, or managing team workflows.
allowed-tools:
  - mcp__linear__list_comments
  - mcp__linear__create_comment
  - mcp__linear__list_cycles
  - mcp__linear__get_document
  - mcp__linear__list_documents
  - mcp__linear__get_issue
  - mcp__linear__list_issues
  - mcp__linear__create_issue
  - mcp__linear__update_issue
  - mcp__linear__list_issue_statuses
  - mcp__linear__get_issue_status
  - mcp__linear__list_issue_labels
  - mcp__linear__create_issue_label
  - mcp__linear__list_projects
  - mcp__linear__get_project
  - mcp__linear__create_project
  - mcp__linear__update_project
  - mcp__linear__list_project_labels
  - mcp__linear__list_teams
  - mcp__linear__get_team
  - mcp__linear__list_users
  - mcp__linear__get_user
  - mcp__linear__search_documentation
  - WebFetch(domain:linear.app)
  - Bash
---

# Linear

Tools and workflows for managing issues, projects, and teams in Linear.

## MCP Tools

The Linear MCP provides tools for working with Linear objects:

### Issues
- `mcp__linear__list_issues` - Query issues with filters (assignee, state, team, project, etc.)
- `mcp__linear__get_issue` - Get detailed issue information by ID
- `mcp__linear__create_issue` - Create new issues
- `mcp__linear__update_issue` - Update existing issues
- `mcp__linear__list_issue_statuses` - List available statuses for a team
- `mcp__linear__get_issue_status` - Get status details by name or ID
- `mcp__linear__list_issue_labels` - List available labels
- `mcp__linear__create_issue_label` - Create new labels

### Projects
- `mcp__linear__list_projects` - List projects with filters
- `mcp__linear__get_project` - Get project details
- `mcp__linear__create_project` - Create new projects
- `mcp__linear__update_project` - Update existing projects
- `mcp__linear__list_project_labels` - List project labels

### Teams & Users
- `mcp__linear__list_teams` - List teams
- `mcp__linear__get_team` - Get team details
- `mcp__linear__list_users` - List workspace users
- `mcp__linear__get_user` - Get user details (supports "me")

### Other
- `mcp__linear__list_comments`, `mcp__linear__create_comment` - Manage issue comments
- `mcp__linear__list_cycles` - Get team cycles
- `mcp__linear__list_documents`, `mcp__linear__get_document` - Access Linear documents
- `mcp__linear__search_documentation` - Search Linear's documentation

## Conventions

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

## GraphQL API

For advanced queries not supported by the MCP, see `api.md` for documentation on using the Linear GraphQL API directly.

### Ad-Hoc Queries

Use `scripts/query.ts` to execute GraphQL queries:

```bash
LINEAR_API_KEY=lin_api_xxx node scripts/query.ts "query { viewer { id name } }"
```

If `LINEAR_API_KEY` is not provided to the Claude process, inform the user that GraphQL queries cannot be executed without an API key.

## Reference

- Linear MCP: https://linear.app/docs/mcp.md
- GraphQL API: See `api.md`
