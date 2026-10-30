# Conventions

House rules for writing to and querying Linear. Tool inputs below are JSON arguments for the connector and MCP tools named in [Tool Selection](../SKILL.md#tool-selection).

## Issue References

An issue reference renders as an inline chip only when Linear resolves it. The two write paths recognize opposite inputs:

- **Connector `save_issue`**: reference an issue by its bare identifier, `ENG-123`. The connector resolves it to a clean `[ENG-123](url)` chip. A URL renders as a plain link, since the connector wraps it in `<>` and Linear stops recognizing it.
- **CLI / GraphQL API**: reference an issue by its URL, either bare (`https://linear.app/workspace/issue/ENG-123`) or hyperlinked (`[the auth bug](https://linear.app/workspace/issue/ENG-123)`). A bare identifier stays literal text.
- **Users, either path**: `@displayname` (for example `@bvdrucker`) chips a user mention on both paths, and is the most portable reference.

Include the `url` field when querying issues you may reference in a CLI/API write.

### Serialization and Round-Trip

Storage is GFM markdown, the canonical interchange form. Raw GraphQL `description` and `linear issue view --json` return it byte-identical. The connector transforms it. On read it projects storage into node markup (`<issue>`, `<user>`, `<linear-embed>`), `>>>` collapsibles, and signed image URLs. On write it parses that markup back to GFM. When content moves between paths:

- Store images by the unsigned `uploads.linear.app` URL the CLI/API return. Signed URLs (`?signature=…`) from a connector read expire within minutes.
- Convert connector node markup to GFM before writing it through the CLI, or read the issue through the CLI/API to get GFM directly. The CLI stores node markup literally.
- A `[ENG-123](url)` link read through the CLI loses its chip when written back through the connector, which `<>`-wraps it. To edit through the connector and keep chips, reference issues by bare identifier, or write through the CLI/API.

## Collapsible Sections

A collapsible renders collapsed, and its marker differs by write path the way [Issue References](#issue-references) do. The title sits on the opening marker. The closing marker is bare. Both need a blank line against the content. Markdown inside behaves normally, headings included.

- **Connector `save_issue`**: `>>>`
- **CLI / GraphQL API**: `+++` (the stored GFM form)

```markdown
+++ 🤖 Agent Context

Gathered at `a1b2c3d` on 1970-01-01.

+++
```

Issue refinement marks its collapsible as a `## 🤖 Agent Context` heading. Replace the heading with the opening marker for your path, keeping its text as the title, and close the block at the end of the body.

## Issue Status

Default a new issue's state from assignment: `Todo` when assigned to me, `Backlog` when unassigned. An explicit state from the user wins. The plugin's hooks apply this default on `save_issue`, `create_issue`, and single `linear issue create` invocations wherever its state options are set. Raw `linear api` mutations stay unhooked, so set `stateId` there, since an issue created with no state lands in Triage on a triage-enabled team.

## CLI Idioms

The CLI addresses the same fields with flags instead of connector JSON:

- **Team** by key: `--team ENG` (the connector takes a team name or ID).
- **Assignee**: `--assignee self` (the connector uses `"me"`).
- **State** by name or type: `--state Todo` or `--state started`.
- **Labels**: one `--label` per entry, repeated.

Pass body text through `--description-file <path>` so it stays out of context and `!` survives the shell. See [Saving a Structured Issue File](structured-file.md) and the `linear-cli:linear-cli` skill.

## Querying Issues

Filter by `assignee: "me"` for the authenticated user's issues. Without an MCP list tool, fall back to GraphQL per [api.md](../api.md).

## Labels

Pass label names directly, no IDs. Labels live at the workspace or team level, so when looking one up with `list_issue_labels`, check the workspace (`{}`) and then the team (`{ "team": "ENG" }`) before concluding it doesn't exist.
