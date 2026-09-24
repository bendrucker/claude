---
fail: [types-first, signatures]
---
```text
dispatch
  deliverWithRetry
    deliver
    backoff
  recordDeadLetter
```

Retries back off exponentially and write a dead letter after the fifth attempt.
