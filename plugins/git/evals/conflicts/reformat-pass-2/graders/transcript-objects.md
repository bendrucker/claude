---
type: regex
pattern: 'typeof \w+ === "object"'
match: contains
target: { source: file, path: .eval-pushed-tree/src/transcript.ts }
---
The branch's object-only filter on transcript entries survives.
