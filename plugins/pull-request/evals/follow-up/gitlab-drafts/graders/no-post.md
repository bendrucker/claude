---
type: tool_used
tool: Bash
input_match: '"command"\s*:\s*"(?:[^"\\]|\\.)*(\bglab\s+mr\s+(note(?!\s+list\b)|approve|update|close|reopen|revoke)\b|discussions\.ts\s+(create|resolve)\b|draft-note\.ts\s+(create|publish|submit|review)\b|\bmutation\b|\bglab\s+api\b(?:[^"\\]|\\.)*(-X|--method)[\s=]*(POST|PATCH|PUT|DELETE))'
min: 0
max: 0
---
No note, draft note, resolve, or approval is posted before the user confirms.
