---
fail: [call-tree, failure-path]
---
1. `main.ts` loads the prod profile.
2. `deploy` calls `buildImage`, pushes it, then `rollout`.
3. `waitHealthy` waits up to 120 seconds, and the deploy throws if it fails.
