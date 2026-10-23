---
fail: []
---
`_platform_memmove` is 53% of self time. `compact_log` reaches it for 44.7% of the run when the full log shifts down one slot per frame, and `encode_frame` for 8.4%.

1. `compact_log` shift via `memmove` (44.7%): use a ring buffer. At most 44.7% of the run, about 1.8x.
2. `encode_frame` checksum loop (28.3%).
3. `compact_log` recent digest (18.7%).
