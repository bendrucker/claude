---
type: regex
pattern: 'Milliseconds to keep checking'
match: contains
target: { source: file, path: src/wait.ts }
---
main's millisecond doc comment survives.
