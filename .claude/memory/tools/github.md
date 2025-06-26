# GitHub

- Prefer using the `github` MCP for GitHub tasks, since calling `gh` from a shell can introduce escaping issues in text inputs.
- Use `gh` CLI commands if needed, especially when the `github` MCP does not support a specific action and the CLI command is straightforward.
- Use `gh api` for advanced GitHub API interactions that are not natively supported by `gh` commands.

## Pull Requests

Use the following style guidelines when creating a GitHub pull request, whether via a `github` MCP tool or the `gh` CLI:

### Title

- Use `$subject: $summary` format. Subject can be an area of the code (e.g., package name) or a type of change, typicall `fix` for bugfixes.
- Use a concise summary of the change, ideally under 50 characters, at absolute most 100.
- Use imperative mood, e.g., "add timeout to request" instead of "added timeout."
- Use lowercase for the subject and summary, except for proper nouns or acronyms.

### Body

#### Preamble

- Do not include a header at the top of the body.
- Start with 1-3 sentences summarizing the change. For very small PRs, this might be the entire body.
- For small summaries, fragments like "Updates the docs to..." or "Fixes an issue with..." are acceptable.
- For bigger changes, "This PR <verb>" is a good starting point.

#### Sections

- Use sections to organize the body of the PR. Each section should be a `##` header.
- Common sections include:
  - `## Issue`: Provide root cause analysis of an issue, typically for bug fixes. If an existing GitHub issue already thoroughly describes the issue, link to it and provide a brief summary.
  - `## Changes`: Describe the changes made in the PR at high level.
  - `## Testing`: Describe how the changes were tested, including a summary of notable test cases.
    - `### Manual`: Describe any manual testing done, including steps to reproduce. Only include this if manual testing was done.
    - `### Automated`: Summarize automated tests added or modified. Highlight any notable additions in coverage. Be concise, don't repeat the test code.
  - `## References`: Link to any relevant issues, PRs, or external resources that provide context for the changes.
    - Include `Closes #<issue>` here if the PR resolves an issue.

## MCP Tools

- `search_issues`: always include `is:issue` or `is:pr` in the query, depending on the desired result type.
