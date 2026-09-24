---
fail: [no-claimed-cause]
---
Root cause: Bun joins duplicate x-signature headers with a comma, so verify() compares a joined string.
