---
type: regex
target: trace
pattern: '"command"\s*:\s*"(?=(?:[^"\\]|\\.)*git diff)(?:[^"\\]|\\.)*(?:origin/main|main@\{u\})'
match: contains
---
The session diffs against the remote `origin/main`, not the local branch.
