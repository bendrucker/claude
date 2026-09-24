---
fail: [pseudocode, no-pasted-code]
---
```ts
if (attempt.tries >= MAX_TRIES) return "give-up";
if (attempt.lastError?.startsWith("4")) return "give-up";
const delay = Math.min(MAX_MS, BASE_MS * 2 ** attempt.tries);
const jitter = Math.random() * delay * 0.2;
```
