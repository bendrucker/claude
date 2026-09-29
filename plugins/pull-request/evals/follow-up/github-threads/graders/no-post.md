---
type: tool_used
tool: Bash
input_match: '"command"\s*:\s*"(?:[^"\\]|\\.)*(\bgh\s+pr\s+(comment|review)\b|review-threads\.ts\s+(reply|resolve|react)\b|\bmutation\b|\bgh\s+api\b(?:[^"\\]|\\.)*(-X|--method)[\s=]*(POST|PATCH|PUT|DELETE))'
min: 0
max: 0
---
No comment, review, reply, resolve, or reaction is posted before the user confirms.
