---
type: regex
target: trace
pattern: '"type":"tool_use","id":"[^"]+","name":"mcp__[^"]*github'
flags: i
match: not_contains
---
Calls no GitHub MCP tool for a GitLab merge request.
