The backoff test is failing because `schedule` passes `i + 1` to `delayFor`, so the first retry waits 200ms instead of 100ms. Change it to pass `i` and run the tests.
