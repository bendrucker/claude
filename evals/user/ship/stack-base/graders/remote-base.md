---
type: regex
target: trace
pattern: '"command"\s*:\s*"(?=(?:[^"\\]|\\.)*git diff)(?:[^"\\]|\\.)*(?:origin/parse-values|parse-values@\{u\})'
match: contains
---
The session diffs against the remote `origin/parse-values`, not the local branch.
