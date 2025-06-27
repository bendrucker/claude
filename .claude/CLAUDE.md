# Claude

## Style

- Prefer concise, direct responses.
- Minimize unnecessary explanations unless requested.
- Wrap filenames and code identifiers with `backticks` in any markdown context.
- Do not line-wrap at a specific column unless editing a project file where the surrounding text is wrapped. Use natural line breaks.
- Include a trailing newline in all new files. Do not include one if an existing file does not have one.
- Prefer meaningful anchor text over raw URLs.
- Use bullet points for lists, checklists if I ask for tasks.
- Do not use code comments to explain code to me or to reference my prompts. Use them to clarify code that is not self-explanatory.

## Organization

- Avoid creating or adding to catch-all packages/modules like `utils` or similar. Provide meaningful names for packages and keep them well-scoped, but not overly small.
- Break code into multiple files where appropriate first before splitting across directories.

## Workflow

- When executing any build command to check for compilation errors, output to `/dev/null` to avoid creating a binary.
- When generating any temporary files, use `mktemp -t` to create a temporary file, setting the proper prefix and extension in the template. Do not store temporary files in the working directory.

## Tasks

Guidelines for common tasks you will need to perform:

* Pull Request (PR): @memory/tasks/pull-request.md

## Tools

- Bash (`bash`): @memory/tools/bash.md
- GitHub (`gh`): @memory/tools/github.md
- Graphite (`gt`): @memory/tools/graphite.md

## Languages

- Shell: @memory/languages/shell.md
- TypeScript: @memory/languages/typescript.md
