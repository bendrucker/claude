# Claude

Adhere to these guidelines when performing your work. 

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

- When executing build commands, output to `/dev/null` to avoid creating binaries.
- Store temporary files in `tmp/` directory.
- Use `pbcopy` and `pbpaste` for clipboard interaction.

## Tasks

Guidelines for common tasks you will need to perform:

* Pull Request (PR): @memory/tasks/pull-request.md

## Tools

- Bash (`bash`): @memory/tools/bash.md
- Git (`git`): @memory/tools/git.md
- GitHub (`gh`): @memory/tools/github.md
- Graphite (`gt`): @memory/tools/graphite.md
- Gemini CLI (`gemini`): @memory/tools/gemini.md

## Languages

- Shell: @memory/languages/shell.md
- TypeScript: @memory/languages/typescript.md
- Go: @memory/languages/go.md
- JSON: @memory/languages/json.md

## Personal Details

- Standard username: `@bendrucker`. Refer to any actions performed by this user as "you."
