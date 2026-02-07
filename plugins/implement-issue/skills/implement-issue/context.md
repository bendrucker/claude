# Gathering Context

Use `mcp__plugin_github_github__issue_read` to understand the issue:

- `method: "get"` — Retrieve issue details (title, body, labels, assignees)
- `method: "get_comments"` — Get comments on the issue
- `method: "get_sub_issues"` — Get sub-issues of the issue
- `method: "get_labels"` — Get labels assigned to the issue

All methods require `owner`, `repo`, and `issue_number` parameters.

Other useful tools:

- `mcp__plugin_github_github__search_issues` — Find related issues (only if alluded to but not linked)
- `mcp__plugin_github_github__search_code` — Find related code (only if identifiers appear to reference code)

For Linear or GitLab issues, load the respective skill for service-specific tools.
