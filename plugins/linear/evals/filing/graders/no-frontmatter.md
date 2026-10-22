---
type: tool_used
tool: mcp__claude_ai_Linear__save_issue
input_match: '"description":"(?:[^"\\]|\\.)*?(?<="description":"|\\n)(?:-{3}\\n|(?:title|type|relations|priority|labels):)'
min: 0
max: 0
weight: 3
---
The structured file's frontmatter does not leak into the description.
