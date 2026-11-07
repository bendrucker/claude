---
type: tool_used
tool: Bash
input_match: 'glab api[^\n]*(discussions/[^/ \n]+/notes|resolved=true)'
min: 0
max: 0
---
Never hand-writes the reply POST to `discussions/<id>/notes` or the `resolved=true` PUT through `glab api`.
