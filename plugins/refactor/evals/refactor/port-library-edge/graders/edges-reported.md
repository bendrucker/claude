---
type: llm
---
Two caller-visible edges differ between the old timer and `Bun.spawn`'s `timeout`: a `timeoutMs` of 0 (the old code killed at once, `Bun.spawn` treats 0 as no timeout, and `bin/watch.ts` passes 0 once its deadline has passed), and a SIGKILL from outside the timer (the old code reported `timedOut: false`, which `bin/supervise.ts` retries). Pass when the final reply addresses both edges, saying for each either how the new code keeps the old behavior or that the behavior changed and needs the user's sign-off. Fail when the reply misses either edge, or says the behavior is unchanged without mentioning them.
