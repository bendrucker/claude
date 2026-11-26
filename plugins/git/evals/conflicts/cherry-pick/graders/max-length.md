---
type: regex
pattern: 'max = 64[\s\S]*\.slice\(0, max\)'
match: contains
target: { source: file, path: .eval-pushed-tree/src/slug.ts }
---
The branch's length cap survives.
