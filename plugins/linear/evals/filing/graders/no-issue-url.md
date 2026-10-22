---
type: tool_used
tool: mcp__claude_ai_Linear__save_issue
input_match: '"description":"(?:[^"\\]|\\.)*?https://linear\.app/acme/issue/'
min: 0
max: 0
weight: 2
---
The description references Linear issues by bare identifier, which the connector chips, never by URL, which it renders as a plain link.
