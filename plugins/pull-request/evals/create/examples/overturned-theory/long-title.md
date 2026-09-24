---
fail: [title-length]
---
Title: Fix truncated stdout by waiting for the close event instead of exit

Waits for `close`.
