# GitHub

- Prefer using the `github` MCP for GitHub tasks, since calling `gh` from a shell can introduce escaping issues in text inputs.
- Use `gh` CLI commands if needed, especially when the `github` MCP does not support a specific action and the CLI command is straightforward.
- Use `gh api` for advanced GitHub API interactions that are not natively supported by `gh` commands.
- Always assume GitHub URLs may refer to private repositories. DO NOT use `WebFetch(domain:github.com)` to interact with repository content.

## Workflows

### Pull Request

- You must `git push` a branch before creating a pull request with `gh pr create`.

## MCP Tools

- `search_issues`: always include `is:issue` or `is:pr` in the query, depending on the desired result type.
