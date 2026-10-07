---
type: tool_used
tool: Bash
input_match: 'glab (mr (note (?!list)|approve|update)|api .*(-X|--method) *(POST|PUT|PATCH))|discussions\.ts (create|resolve)|draft-note\.ts (create|publish|submit|review)'
min: 0
max: 0
---
Never posts a note, drafts a review note, approves, or resolves a thread.
