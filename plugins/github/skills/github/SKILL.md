---
name: github
description: GitHub workflow best practices and tool selection. Use when working with GitHub repositories, pull requests, issues, or GitHub API interactions.
hooks:
  PreToolUse:
    - matcher: WebFetch
      hooks:
        - type: command
          command: "${CLAUDE_PLUGIN_ROOT}/scripts/fetch.sh"
---
# GitHub

- Prefer using the `github` MCP for GitHub tasks, since calling `gh` from a shell can introduce escaping issues in text inputs.
- Use `gh` CLI commands if needed, especially when the `github` MCP does not support a specific action and the CLI command is straightforward.
- Use `gh api` for advanced GitHub API interactions that are not natively supported by `gh` commands.
- Always assume GitHub URLs may refer to private repositories and use `gh` or `mcp__github` for authentication.

## Reference Files

- **reviews.md**: Pull request review operations not supported by the MCP

## Workflows

### Pull Request

- You must `git push` a branch before creating a pull request with `gh pr create`.

## MCP Tools

- `search_issues`: always include `is:issue` or `is:pr` in the query, depending on the desired result type.
