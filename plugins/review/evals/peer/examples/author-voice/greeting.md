---
fail: [no-greeting]
---
<comments>
Hey, nice work on this!

**src/retry.ts** `retry`

`return fn()` needs an `await`, or a rejected delivery escapes the `catch` and is never retried.
</comments>
