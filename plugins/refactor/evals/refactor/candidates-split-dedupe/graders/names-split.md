---
type: llm
focus: last_message
---
`src/server.ts` holds config loading, logging, rate limiting with module-level state, bearer-token auth, HTML rendering, a route registry, and the request handler, and it changed in most commits. Pass when the final reply ranks `src/server.ts` as a split target, lists at least three of those responsibilities, and names at least one hazard a split must keep, such as `registerRoutes()` running at import (a test asserts four routes), the `import.meta.main` entrypoint, or the shared rate-limit map. Fail when `server.ts` is missing or listed with no responsibilities.
