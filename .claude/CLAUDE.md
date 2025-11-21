# Claude

## Style

- Prefer concise, direct responses.
- Minimize unnecessary explanations unless requested.
- Wrap filenames and code identifiers with `backticks` in any markdown context.
- Use natural line breaks unless the surrounding code is wrapped at a specific column.
- Include a trailing newline in all new files.
- Prefer meaningful anchor text over raw URLs.
- Use bullet points for lists, checklists if I ask for tasks.
- Use code comments ONLY to clarify code that is not self-explanatory to OTHER readers. If you need to explain the code, do so in a separate message before editing.

## Organization

- Avoid creating or adding to catch-all packages/modules like `utils` or similar. Provide meaningful names for packages and keep them well-scoped, but not overly small.
- Break code into multiple files where appropriate first before splitting across directories.

## Workflow

- The user has carefully curated skills for their common workflows. Load skills when possible to adhere to the user's preferences and navigate their projects efficiently.
- For questions about Claude Code features or usage, use the Task tool with `subagent_type='claude-code-guide'` to consult official documentation.
- When executing build commands, output to `/dev/null` to avoid creating binaries.
- Store temporary files in `tmp/` directory.
- Use `pbcopy` and `pbpaste` for clipboard interaction.

## Personal Details

- Standard username: `@bendrucker`. Refer to any actions performed by this user as "you."
