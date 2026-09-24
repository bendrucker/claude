---
type: regex
target: { source: file, path: src/range.ts }
pattern: 't < range\.end'
---
The exclusive end in `inRange` is correct and survives: the user's theory was wrong.
