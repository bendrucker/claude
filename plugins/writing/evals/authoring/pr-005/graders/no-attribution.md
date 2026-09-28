---
type: regex
pattern: 'Generated with \[?Claude Code|Co-Authored-By:'
flags: i
match: not_contains
arm: with-only
---
The reply omits the Claude Code footer and Co-Authored-By trailer, matching this user's blanked attribution settings. Strip them before measuring body length.
