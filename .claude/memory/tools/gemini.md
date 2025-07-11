# Gemini CLI

Use `gemini --prompt` to leverage Google Gemini's large context window when analyzing large codebases that exceed Claude's context limits.

## Syntax

Use `@` to include files/directories:
- `@src/file.py` - single file
- `@src/ @tests/` - multiple directories  
- `@./` - current directory and subdirectories
- `--all-files` - all files in project

## When to Use

- Analyzing entire codebases or large directories
- Files totaling more than 100KB
- Verifying implementations across the entire codebase
- Understanding project-wide patterns or architecture

## Examples

```bash
gemini --prompt "@src/ Summarize the architecture of this codebase"
gemini --prompt "@src/ @tests/ Has authentication been implemented? Show relevant files"
gemini --all-files --prompt "Analyze the project structure and dependencies"
```
