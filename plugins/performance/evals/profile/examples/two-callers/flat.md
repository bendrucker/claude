---
fail: [bound, callers, fix-first]
---
`hash_key` is 95% of the run.

1. `hash_key` (95%): six rounds per byte. Use a cheaper hash.
2. `next_line` (4%): input generation.
