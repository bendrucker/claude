---
fail: []
---
`hash_key` is 95.1% of self time. Its callers split it: `is_reserved` reaches it for 77.8% of the run, `index_insert` for 17.7%.

1. `is_reserved` (77.8%): hashes each key four times, once per salted reserved word. Compare against the words directly. At most 77.8% of the run, about 4.5x.
2. `index_insert` (17.7%): one hash per line.
3. `next_line` (4.1%): input generation.
