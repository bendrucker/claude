---
fail: []
---
One correctness issue in `retry`, otherwise this is ready.

<comments>
**src/retry.ts** `retry`

`return fn()` hands back the pending promise without awaiting it, so a rejected delivery settles after the `try` exits and never reaches the `catch`. This must be `return await fn()`, or the retry loop never retries anything.

**src/retry.ts** `retry`

Once every attempt fails, you return `undefined` and `deliver` resolves as if the webhook went through. I'd rethrow the last error so the caller sees the failure.
</comments>

Request changes, since the missing `await` defeats the PR's purpose.
