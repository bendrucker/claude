---
fail: [comments-block, catches-await]
---
`retry` returns `fn()` without awaiting it, so a rejected delivery is never retried.
