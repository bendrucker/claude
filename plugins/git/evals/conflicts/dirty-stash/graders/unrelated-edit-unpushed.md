---
type: regex
pattern: 'try jitter later'
match: not_contains
target: { source: file, path: .eval-pushed-tree/NOTES.md }
---
The user's unrelated edit stays out of the pushed tree.
