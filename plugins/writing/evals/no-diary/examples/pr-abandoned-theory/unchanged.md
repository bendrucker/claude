---
fail: [no-abandoned-theory, no-sequencing, no-test-tally]
---
<rewrite>
This PR fixes the retry bug. Initially we thought the exit code was being swallowed by the wrapper, so the first approach added a status check in `run()`. That turned out to be wrong. After adding logging we found the real cause: `spawn` was being awaited before the stream drained, so the exit event fired against a closed handle. We then reverted the status check and moved the await below the drain. Along the way we also discovered the timeout path had the same shape, so that got fixed too. All tests pass (47 passing).
</rewrite>
