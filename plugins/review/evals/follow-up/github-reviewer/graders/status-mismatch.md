---
type: llm
---
The reply flags the resolved connection-leak thread on `pool.ts` as only partly fixed, because `withTransaction` still skips `client.release()` after a rollback.
