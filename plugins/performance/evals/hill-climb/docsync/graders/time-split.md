---
type: regex
target: { source: file, path: bench/CLIMB.md }
pattern: '(fetch[^#]{0,200}?apply|apply[^#]{0,200}?fetch)[^#]{0,200}?(71|5[78]|133|41)(\.\d+)?\s?s|(71|133)(\.\d+)?\s?s[^#]{0,200}?(fetch[^#]{0,200}?apply|apply[^#]{0,200}?fetch)'
flags: im
match: contains
---
The notes say where the real run's time goes: fetch and apply, with the release-sync log's numbers.
