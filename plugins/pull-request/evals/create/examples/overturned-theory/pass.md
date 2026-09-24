---
fail: []
---
Title: run: drain stdout before resolving exit

Fixes truncated output from `run()`: it resolved on the child's `exit` event, which can fire before stdout finishes draining, so the tail of the output was lost. It now waits for `close`. The wrapper was suspected of swallowing the exit code, but the code was right all along. The unit test for the race was dropped because the test runner could not make it fail.
