---
type: tool_used
tool: Bash
input_match: 'pr-comments\.ts[^"]*--include-resolved|reviewThreads'
---
The session fetches resolved threads alongside unresolved ones, through `pr-comments.ts --include-resolved` or a GraphQL `reviewThreads` query.
