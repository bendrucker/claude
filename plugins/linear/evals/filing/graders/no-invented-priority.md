---
type: regex
target: trace
pattern: '"name":"mcp__claude_ai_Linear__save_issue","input":\{[^}]*"priority":'
match: not_contains
---
No priority unless the request or file gives one.
