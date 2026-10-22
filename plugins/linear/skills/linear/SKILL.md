---
name: linear
description: Load before any Linear write or query, whether through the connector tools (save_issue, create_comment, list_issues) or the linear CLI. Direct calls get Linear-specific formatting wrong (issue references that chip, collapsible markers, relations as params). Use when filing, updating, commenting on, or listing Linear issues, projects, or backlogs.
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

The connector and MCP paths need no CLI. Before a CLI-only operation (relations without the connector, bulk work), run `linear --version`. When it fails, stay on the connector. Confirm the installed CLI's subcommands and flags with `linear <cmd> --help` or the `linear-cli:linear-cli` skill rather than assuming them.

## Arguments

`$0` is an optional verb (`create`, `update`, `list`, `view`, `comment`) and the rest are its params. With no verb, infer the operation from the request.

## Tool Selection

1. **Claude.ai connector** (`mcp__claude_ai_Linear__*`) is the primary path. `save_issue` creates or updates, and takes relations (`blocks`, `blockedBy`, `relatedTo`, `duplicateOf`), `parentId`, `project`, `milestone`, `cycle`, `estimate`, `dueDate`, and `links` as params.
2. **Local or plugin MCP** splits `save_issue` into `create_issue` and `update_issue` with the same flat fields. Use it when the connector is unavailable.
3. **`linear` CLI and GraphQL** covers bulk work, complex queries, and relations without the connector. Defer to the `linear-cli:linear-cli` skill for the CLI surface and [api.md](api.md) for raw GraphQL.

## Saving an Issue

`save_issue` creates when `id` is absent and updates when it is present. An update sends only the fields that change. Relation params are append-only, so a save never removes a relation you did not name. Pass `duplicateOf`, `parentId`, `project`, or `cycle` as `null` to clear one. `milestone` and `dueDate` have no `null` clear.

The `description` body is GFM and renders Linear's first-class constructs directly. Author them inline instead of using a workaround:

- Fence code and traces, and put a repro command in a `sh` block even when it is one line. Fold a pasted log or trace over about 15 lines into a [collapsible](references/conventions.md#collapsible-sections) titled for its source, and keep shorter ones inline.
- Draw a mermaid sequence diagram when the report describes several actors interleaving, such as a race or a handoff. A bug in one component doesn't need one.
- Turn criteria or tasks the request supplies into a check list (`- [ ]`). Leave next steps, fix plans, and verification tasks to whoever picks the issue up unless the request lists them.

Keep the title under 10 words. Size the body to the request. A one-line report gets one or two sentences under 40 words, with no headings and no sections the request never supplied.

## Answering a Query

Answer a list query with one line per issue, each its linked identifier, title, and state, with no grouping headers, blank lines, or closing summary.

## Saving a Structured Issue File

Skills that emit a Markdown file with YAML frontmatter (issue refinement, project planning) hand off here. [references/structured-file.md](references/structured-file.md) maps that frontmatter onto connector `save_issue` params, relations included, covers routing fields taken from the user at save time, and keeps the `linear` CLI as the fallback when the connector is unavailable.

## Conventions

Apply [references/conventions.md](references/conventions.md) whenever you create, update, comment, or query: issue references by write path, collapsible markers, default state, queries, and labels.
