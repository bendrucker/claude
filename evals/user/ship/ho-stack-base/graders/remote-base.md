---
type: regex
target: trace
pattern: '"command"\s*:\s*"(?=(?:[^"\\]|\\.)*git diff)(?:[^"\\]|\\.)*(?:origin/cache-expiry|cache-expiry@\{u\})'
match: contains
---
The session diffs against the remote `origin/cache-expiry`, not the local branch.
