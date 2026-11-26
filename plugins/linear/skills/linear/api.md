# Linear GraphQL API via CLI

Use raw GraphQL through `linear api` for operations the connector and MCP tools do not cover, per [Tool Selection](SKILL.md#tool-selection). The `linear-cli:linear-cli` skill covers all CLI subcommands and GraphQL mechanics (`--description-file`, schema introspection, pagination). Schema docs: [linear.app/developers/graphql](https://linear.app/developers/graphql).

Install with `brew install schpet/tap/linear` and authenticate once with `linear auth login`.

Output is JSON on stdout:

```bash
linear api 'query { viewer { id name email } }' | jq '.data.viewer'
```

Pass multi-line queries through a quoted heredoc on stdin. The quoted delimiter keeps the shell from expanding `$id`.

```bash
linear api --variable id=ISSUE_ID <<'GRAPHQL'
query($id: String!) {
  issue(id: $id) { title url state { name } }
}
GRAPHQL
```
