---
type: regex
pattern: '^(?=[^\n]*queue_pop)(?=[^\n]*(memmove|shift|front|O\(n|quadratic|n\^?2|n²))'
flags: im
match: contains
---
`_platform_memmove` holds about 77% of the run, all of it under `queue_pop`, which shifts the whole array to remove the front job.
