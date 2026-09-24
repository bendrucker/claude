---
fail: [no-claimed-cause]
---
The bug is in server.ts: it never decompresses the body.
