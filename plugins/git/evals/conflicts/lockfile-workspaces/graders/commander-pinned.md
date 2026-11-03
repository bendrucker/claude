---
type: regex
pattern: '"commander@15.0.0"'
match: contains
target: { source: file, path: bun.lock }
---
main's locked commander 15.0.0 survives.
