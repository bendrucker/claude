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

- `create`: create an issue. See [Creating vs Updating](#creating-vs-updating) and Issue Status in [references/conventions.md](references/conventions.md).
- `update`: update an issue by id. See [Creating vs Updating](#creating-vs-updating).
- `list`: query issues. See Querying Issues in [references/conventions.md](references/conventions.md).
- `view`: fetch a single issue; include its `url` for anything you may reference.
- `comment`: comment on an issue, using full URLs per Issue References in [references/conventions.md](references/conventions.md).

Pick a tool path per [Tool Selection](#tool-selection).

## Tool Selection

Three runtime paths reach Linear, in order of preference:

1. **Claude.ai connector** (`mcp__claude_ai_Linear__save_issue`, `get_issue`) is the primary path. One tool, `save_issue`, handles both create and update. It also takes relations (`blocks`, `blockedBy`, `relatedTo`, `duplicateOf`), `parentId`, `project`, `milestone`, `cycle`, `estimate`, `dueDate`, and `links` as params. That covers most structured single-issue work end to end. See [Creating vs Updating](#creating-vs-updating).
2. **Local or plugin MCP** (`create_issue`, `update_issue`, `list_issues`) exposes separate tools for create and update. Use it for simple single-issue operations when the connector is unavailable.
3. **`linear` CLI and raw GraphQL** is the fallback for what the connector does not cover (complex queries, bulk operations) and for setting relations when the connector is unavailable. Defer to the `linear-cli:linear-cli` skill for the CLI surface. See [GraphQL API](#graphql-api).

Turning a structured issue file (from issue refinement, project planning, or any skill that emits one) into an issue follows this order. The connector handles the whole file, relations included; the CLI is the fallback when the connector is unavailable. See [Saving a Structured Issue File](#saving-a-structured-issue-file).

## Creating vs Updating

The connector's `save_issue` creates or updates from a single tool, keyed on whether you pass an `id`. Check before every call:

- **Create**: omit `id`. `title` is **required** (omitting it produces "title is required when creating an issue").
- **Update**: pass `id` (from `get_issue`). `title` is optional; send only the fields you change.
- Use flat top-level keys. No wrapper objects (`issue`, `input`, `parameters`), and the field is `id`, not `issueId`.
- Relation params (`blocks`, `blockedBy`, `relatedTo`) are append-only. A save never removes relations you did not name. Pass `duplicateOf`, `parentId`, `project`, or `cycle` as `null` to clear them. `milestone` and `dueDate` take a value but have no `null` clear.

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

The local and plugin MCP variants split these into `create_issue` and `update_issue` with the same flat field shapes. The create precondition (`title` required) applies to both paths.

The `description` body is GFM and renders Linear's first-class constructs directly: mermaid diagrams, collapsibles, fenced code blocks, and check lists. Author them inline instead of using a workaround.

## Saving a Structured Issue File

Skills that emit a Markdown file with YAML frontmatter (issue refinement, project planning) hand off here. [references/structured-file.md](references/structured-file.md) maps that frontmatter onto connector `save_issue` params, relations included, covers routing fields taken from the user at save time, and keeps the `linear` CLI as the fallback when the connector is unavailable.

## Conventions

[references/conventions.md](references/conventions.md) holds the house rules: reference issues by the form the write path chips (bare identifier for the connector, URL for the CLI/API, `@displayname` for users on both), default state from assignment (assigned to me is `Todo`, unassigned is `Backlog`), query with `assignee: "me"`, and pass label names directly (checking workspace then team when looking one up). Apply it whenever you create, update, comment, or query.

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
