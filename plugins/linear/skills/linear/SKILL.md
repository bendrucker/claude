---
name: linear
description: Interacting with Linear issues, projects, and teams. Use when creating issues, updating issues, querying issues, managing projects, working on tasks, discussing backlogs, or any interaction with Linear.
argument-hint: "[create | update | list | view | comment] [issue ...]"
allowed-tools:
  - mcp__linear
  - mcp__claude_ai_Linear
  - WebFetch(domain:linear.app)
  - Bash
---

# Linear

Tools and workflows for managing issues, projects, and teams in Linear.

## Environment

- **`linear` CLI**: !`command -v linear >/dev/null 2>&1 && linear --version 2>/dev/null || echo "not installed"`

The connector and MCP paths need no CLI. The CLI-only operations (relations, bulk work) require `linear`; when it reads "not installed", stay on the connector. The version above tells you which CLI is installed. Confirm its exact subcommands and flags with `linear <cmd> --help` or the `linear-cli:linear-cli` skill rather than assuming them.

## Arguments

`$0` (optional verb) routes to an operation; pass the rest (issue id, title, filters) as its params. With no verb, infer the operation from the request.

- `create`: create an issue. See [Creating vs Updating](#creating-vs-updating) and [Issue Status](#issue-status).
- `update`: update an issue by id. See [Creating vs Updating](#creating-vs-updating).
- `list`: query issues. See [Querying Issues](#querying-issues).
- `view`: fetch a single issue; include its `url` for anything you may reference.
- `comment`: comment on an issue, using full URLs per [Issue References](#issue-references).

Pick a tool path per [Tool Selection](#tool-selection).

## Tool Selection

Three runtime paths reach Linear, in order of preference:

1. **Claude.ai connector** (`mcp__claude_ai_Linear__save_issue`, `get_issue`) is the primary path. One tool, `save_issue`, handles both create and update. See [Creating vs Updating](#creating-vs-updating).
2. **Local or plugin MCP** (`create_issue`, `update_issue`, `list_issues`) exposes separate tools for create and update. Use it for simple single-issue operations when the connector is unavailable.
3. **`linear` CLI and raw GraphQL** is the fallback for what the connector and MCP tools do not cover (complex queries, bulk operations, relations). Defer to the `linear-cli:linear-cli` skill for the CLI surface. See [GraphQL API](#graphql-api).

Turning a structured issue file (from issue refinement, project planning, or any skill that emits one) into an issue follows this order. The connector handles a simple save. The CLI path is required only when the file declares relations, which the connector and MCP tools cannot set. See [Saving a Structured Issue File](#saving-a-structured-issue-file).

## Creating vs Updating

The connector's `save_issue` creates or updates from a single tool, keyed on whether you pass an `id`. Check before every call:

- **Create**: omit `id`. `title` is **required** (omitting it produces "title is required when creating an issue").
- **Update**: pass `id` (from `get_issue`). `title` is optional; send only the fields you change.
- Use flat top-level keys. No wrapper objects (`issue`, `input`, `parameters`), and the field is `id`, not `issueId`.
- Omit relation fields the connector does not natively support.

Create (`id` absent, `title` present):

```json
{
  "team": "ENG",
  "title": "Fix authentication bug",
  "assignee": "me",
  "state": "Todo"
}
```

Update (`id` present, change only what you need):

```json
{
  "id": "ENG-123",
  "state": "In Progress"
}
```

The local and plugin MCP variants split these into `create_issue` and `update_issue`, shown in the examples below. The create precondition (`title` required) applies to both paths.

## Saving a Structured Issue File

Several skills hand off a Markdown file with YAML frontmatter for issue metadata and a body below the closing `---`. Issue refinement emits one, project planning emits a similar file, and others will follow. This section maps that shape to a Linear issue. The schema varies by producer, so read the file's frontmatter to see which keys it actually carries, extract them with whatever fits that file, and write the body to its own file so it passes by path and stays out of context.

Map the metadata keys these files tend to carry onto the `linear` CLI:

| Frontmatter | Linear |
|-------------|--------|
| `title` | `--title` |
| body (below the closing `---`) | `--description-file <path>` |
| `labels` | one `--label` per entry |
| `priority` (`urgent`, `high`, `medium`, `low`) | `--priority` `1`..`4` |
| `relations` (`blocks`, `blocked-by`, `related`, `duplicate-of`) | `linear issue relation add <id> <type> <relatedId>` |

A relation's `type` is the frontmatter key, except `duplicate-of` maps to `duplicate`. Its `relatedId` is the issue identifier in the relation's tracker URL. For keys the file omits, or ones this table does not name, map them when Linear has a matching field and ask when the mapping is unclear.

Routing fields (team, assignee, state) are not in the file. Take them from the user at save time. Default the state from assignment as in [Issue Status](#issue-status). `getDefaultState` in `hooks/save-issue.ts` encodes that rule.

### Simple Saves

When the file declares no relations, the connector `save_issue` is enough: pass the title, the body as `description`, the labels, and the routing fields, per [Creating vs Updating](#creating-vs-updating). This is the default.

### Relations

The connector and MCP tools cannot set relations, so a file that declares any needs the `linear` CLI. When the Environment block shows it is not installed, save through the connector and report the relation targets you skipped so the user can add them by hand.

With the CLI present, create the issue with the body by file, then add one relation per entry from the parsed frontmatter:

```bash
new_id=$(linear issue create --title "$title" --description-file "$body_file" \
  --team "$team" --state "$state" | grep -oE '[A-Z][A-Z0-9]*-[0-9]+' | head -1)
linear issue relation add "$new_id" blocked-by ENG-100
```

Add `--label`, `--assignee`, and `--priority` when the file carries them. The `linear-cli:linear-cli` skill documents the full CLI surface.

## Conventions

### Issue References

When writing text that references other issues (descriptions, comments, updates), never use bare identifiers like `ENG-123`. Linear auto-renders issue URLs as inline previews, so use the full URL:

- **Bare URL**: `https://linear.app/workspace/issue/ENG-123` (renders as an inline preview)
- **Hyperlinked text**: `[the auth bug](https://linear.app/workspace/issue/ENG-123)` (when linking specific words is more natural)

Both MCP tools and GraphQL queries return a `url` field on issues. Always include `url` when querying issues you may reference in writing.

### Issue Status

When creating issues, set status based on assignment:

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

Use label names directly in `create_issue` and `update_issue` — no need to look up IDs:

```typescript
await linear.create_issue({
  team: "ENG",
  title: "Update documentation",
  labels: ["documentation", "high-priority"]
})
```

**Label Lookup**: Labels can exist at the workspace or team level. Check both:

1. Workspace labels: `list_issue_labels()` (no team filter)
2. Team labels: `list_issue_labels({ team: "TEAM" })`

If a label isn't found at the workspace level, check the team before concluding it doesn't exist.

## GraphQL API

Use `linear api` for queries and mutations not supported by MCP tools. See `api.md`.

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

The desktop app must be installed. Construct the URL from the team's workspace slug and issue identifier.

## Reference

- Linear MCP: https://linear.app/docs/mcp.md
- GraphQL API: See `api.md`
