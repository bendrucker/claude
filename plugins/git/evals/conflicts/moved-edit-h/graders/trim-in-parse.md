---
type: regex
pattern: 'strings\.Cut\(strings\.TrimSpace\(s\), "\."\)'
match: contains
target: { source: file, path: .eval-pushed-tree/parse.go }
---
The moved parser keeps the whitespace fix.
