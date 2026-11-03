---
type: regex
pattern: '"yaml@2.8.0"'
match: contains
target: { source: file, path: bun.lock }
---
main's locked yaml 2.8.0 survives instead of floating.
