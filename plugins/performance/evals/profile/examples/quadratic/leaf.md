---
fail: [bound, pop-front, top]
---
1. `run_job` (22.9%): the hash loop.
2. `_platform_memmove` (76.8%): a libc copy we can't change.
