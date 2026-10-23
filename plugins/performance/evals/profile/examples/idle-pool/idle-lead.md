---
fail: [no-idle-lead, share, single-thread, top]
---
1. `__psynch_cvwait` (60% of wall): threads block in cond_wait.
2. `nanosleep` (20%): the flusher.
