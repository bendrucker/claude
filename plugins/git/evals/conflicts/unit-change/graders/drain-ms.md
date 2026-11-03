---
type: regex
pattern: 'timeout: (30_000|30000|30 \* 1000)\b'
match: contains
target: { source: file, path: src/drain.ts }
---
The fifth caller passes a millisecond timeout.
