# Conventions

House rules for writing to and querying Linear. Tool inputs below are JSON arguments for the connector and MCP tools named in [Tool Selection](../SKILL.md#tool-selection).

## Issue References

An issue reference renders as an inline chip only when Linear resolves it to a real entity. The two write paths recognize opposite inputs for the same issue. The correct form depends on which path you write through.

- **Connector `save_issue`**: reference an issue by its bare identifier, `ENG-123`. The connector resolves it to a clean `[ENG-123](url)` chip. A URL renders as a plain link, since the connector wraps it in `<>` and Linear stops recognizing it.
- **CLI / GraphQL API**: reference an issue by its URL, either bare (`https://linear.app/workspace/issue/ENG-123`) or hyperlinked (`[the auth bug](https://linear.app/workspace/issue/ENG-123)`). A bare identifier stays literal text.
- **Users, either path**: `@displayname` (for example `@bvdrucker`) chips a user mention on both paths, and is the most portable reference.

Both connector tools and GraphQL queries return a `url` field on issues. Include `url` when querying issues you may reference in writing. The CLI/API path needs it.

### Serialization and Round-Trip

Storage is GFM markdown. Raw GraphQL `description` and `linear issue view --json` return byte-identical markdown. The CLI is a pass-through of stored content. The connector is a transformer. On read it projects storage into node markup (`<issue>`, `<user>`, `<linear-embed>`), `>>>` collapsibles, and signed image URLs. On write it parses that markup back to GFM. GFM is the canonical interchange form.

This matters when content moves between the two paths:

- Signed image URLs (`?signature=…`) from a connector read expire within minutes and return 401 afterward. Never copy one into stored content. The durable form is the unsigned `uploads.linear.app` URL that the CLI/API return.
- Moving connector output to the CLI requires converting node markup to GFM first. Raw node markup written through the CLI is stored literally and corrupted. Reading the same issue via CLI/API returns GFM directly.
- A `[ENG-123](url)` link read through the CLI loses its chip when written back through the connector, which `<>`-wraps it. To edit through the connector and keep chips, reference issues by bare identifier, or write through the CLI/API.

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

`hooks/save-issue.ts` injects this default on the MCP tool paths (the connector `save_issue` and the local or plugin `create_issue`), and only when creating without an explicit `state`. The CLI/API path is not hooked. Set the state yourself there.

## CLI Idioms

The CLI addresses the same fields with flags instead of connector JSON:

- **Team** by key: `--team ENG` (the connector takes a team name or ID).
- **Assignee**: `--assignee self` (the connector uses `"me"`).
- **State** by name or type: `--state Todo` or `--state started`.
- **Labels**: one `--label` per entry, repeated.

Pass body text through `--description-file <path>` so it stays out of context and `!` survives the shell. See [Saving a Structured Issue File](structured-file.md) and the `linear-cli:linear-cli` skill.

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
