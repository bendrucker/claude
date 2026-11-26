---
type: regex
pattern: 'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS'
match: not_contains
target: { source: file, path: plugins/github/README.md }
---
The branch's removal of the function-hooks flag holds in the GitHub README.
