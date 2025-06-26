# Claude

## Style

- Prefer concise, direct responses.
- Minimize unnecessary explanations unless requested.
- Use backticks for filenames and code references.
- Prefer meaningful anchor text over raw URLs.
- Use bullet points for lists, checklists if I ask for tasks.
- Do not use code comments to explain code to me or to reference my prompts. Use them to clarify code that is not self-explanatory.

## Tools

### GitHub

- Prefer using the `github` MCP for GitHub tasks, since calling `gh` from a shell can introduce escaping issues in text inputs.
- Use `gh` CLI commands if needed, especially when the `github` MCP does not support a specific action and the CLI command is straightforward.
- Use `gh api` for advanced GitHub API interactions that are not natively supported by `gh` commands.

