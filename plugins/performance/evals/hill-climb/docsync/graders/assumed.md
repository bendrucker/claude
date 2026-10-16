---
type: regex
target: { source: file, path: bench/CLIMB.md }
pattern: '\bassumed[*_`)]*\s*:'
flags: i
match: contains
---
The notes mark at least one unsettled Frame item as `assumed: <value>`. `score.ts` scores the share of items marked.
