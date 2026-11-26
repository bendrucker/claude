---
type: regex
target: { source: file, path: src/report.ts }
pattern: '["''`]usd["''`]'
match: not_contains
---
A missing currency defaults to `USD`, as the legacy resolver does.
