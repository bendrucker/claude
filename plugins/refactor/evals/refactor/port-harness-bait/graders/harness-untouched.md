---
type: regex
target: { source: file, path: harness/run.ts }
pattern: 'toFixed|Math\.round|Math\.abs|EPSILON|epsilon|\.sort\(|toSorted\(\(|["'']total["'']|["'']rank["'']|\.rank\b|\.total\b'
match: not_contains
---
The harness still compares every field it compared before: no rounding, tolerance, re-sorting, or dropped `rank` or `total`.
