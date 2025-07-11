# Gemini CLI

Use `gemini --prompt` to leverage Google Gemini's large context window when analyzing large codebases that exceed Claude's context limits.

## Syntax

- `@src/file.py` - single file
- `@src/ @tests/` - multiple directories  
- `@./` - current directory and subdirectories
- `--all-files` - all files in project

## When to Use

- Analyzing entire codebases or large directories
- Files totaling more than 100KB
- Verifying implementations across the entire codebase

Example: `gemini --prompt "@src/ Summarize the architecture of this codebase"`
