---
type: regex
pattern: '" 12\.50\\n"'
match: contains
target: { source: file, path: .eval-pushed-tree/parse_test.go }
---
The branch's padded-input test row lands beside the moved tests.
