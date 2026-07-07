# Conventions

House rules for writing to and querying Linear. Tool inputs below are JSON arguments for the connector and MCP tools named in [Tool Selection](../SKILL.md#tool-selection).

## Issue References

When writing text that references other issues (descriptions, comments, updates), never use bare identifiers like `ENG-123`. Linear auto-renders issue URLs as inline previews, so use the full URL:

- **Bare URL**: `https://linear.app/workspace/issue/ENG-123` (renders as an inline preview)
- **Hyperlinked text**: `[the auth bug](https://linear.app/workspace/issue/ENG-123)` (when linking specific words is more natural)

Both MCP tools and GraphQL queries return a `url` field on issues. Always include `url` when querying issues you may reference in writing.

## Issue Status

When creating issues, set status based on assignment:

- **Assigned to me** (`assignee: "me"`): Set `state: "Todo"`
- **Unassigned**: Set `state: "Backlog"`

Input for the connector `save_issue` or MCP `create_issue`:

```json
{
  "team": "ENG",
  "title": "Fix authentication bug",
  "assignee": "me",
  "state": "Todo"
}
```

Unassigned:

```json
{
  "team": "ENG",
  "title": "Research API performance",
  "state": "Backlog"
}
```

## Querying Issues

Use `assignee: "me"` to filter issues assigned to the authenticated user. Input for the MCP `list_issues` tool:

```json
{ "assignee": "me" }
```

Team backlog:

```json
{ "team": "ENG", "state": "Backlog" }
```

When no MCP list tool is available, fall back to GraphQL per [GraphQL API](../SKILL.md#graphql-api).

## Labels

Use label names directly when creating or updating; no need to look up IDs:

```json
{
  "team": "ENG",
  "title": "Update documentation",
  "labels": ["documentation", "high-priority"]
}
```

Labels can exist at the workspace or team level. Check both with the MCP `list_issue_labels` tool:

1. Workspace labels: no `team` filter (empty input `{}`)
2. Team labels: `{ "team": "TEAM" }`

If a label isn't found at the workspace level, check the team before concluding it doesn't exist.
