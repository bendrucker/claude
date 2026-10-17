---
fail: [no-author-name]
---
Priya's PR needs one fix.

<comments>
**src/retry.ts** `retry`

Priya returns `fn()` without an `await`, so a rejected delivery escapes the `catch` and is never retried. The author should change this to `return await fn()`.
</comments>
