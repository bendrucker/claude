---
type: regex
pattern: 'human_size <bytes>'
match: contains
target: { source: file, path: .eval-pushed-tree/lib/size.sh }
---
main's byte-based usage line is kept.
