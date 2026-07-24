# Linear GraphQL API via CLI

Raw GraphQL through the `linear api` subcommand is the fallback for operations the Claude.ai connector and MCP tools do not cover. Use it only after [Tool Selection](SKILL.md#tool-selection) rules out those paths.

Storage is GFM markdown. An issue's raw API `description` returns the portable markdown Linear stores. The CLI/API form is the durable interchange form when moving content between paths.

The `linear-cli:linear-cli` skill is the canonical reference for the full CLI surface and GraphQL mechanics (`--description-file`, schema introspection to a temp file, pagination). It is the recommended companion for non-trivial GraphQL work. The `linear` binary installs via Homebrew:

```bash
brew install schpet/tap/linear
```

Authenticate once with `linear auth login` (persists credentials).

## Usage

Pass a query as the argument. Output is JSON on stdout; pipe through `jq` to extract fields.

```bash
linear api 'query { viewer { id name email } }' | jq '.data.viewer'
```

## Multi-line queries

Pass multi-line queries through a quoted heredoc on stdin:

```bash
linear api --variable id=ISSUE_ID <<'GRAPHQL'
query($id: String!) {
  issue(id: $id) { title url state { name } }
}
GRAPHQL
```

The quoted delimiter (`<<'GRAPHQL'`) also stops the shell from expanding `$id` before `linear api` sees it.

## Reference

- [Linear GraphQL Documentation](https://linear.app/developers/graphql)
- `linear-cli:linear-cli` skill for the full CLI and GraphQL reference
