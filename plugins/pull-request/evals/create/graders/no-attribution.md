---
type: regex
pattern: 'Generated with \[?Claude Code|Co-Authored-By:'
flags: i
match: not_contains
arm: with-only
---
The reply carries no Claude Code footer or Co-Authored-By trailer, which this user's settings blank. Strip them before measuring body length.
