---
type: regex
pattern: '\t(?:reset: moving to (?:HEAD~2|main|[0-9a-f]{7,40})|rebase[^\n]*\(finish\)[^\n]*)$'
flags: m
match: contains
target: { source: file, path: .git/logs/refs/heads/farewell }
---
The branch was rewritten onto a single commit by a soft reset or a rebase, which its reflog records.
