---
fail: [cause]
---
`process.env` is read before Bun loads the variable, so the threshold stays at info.
