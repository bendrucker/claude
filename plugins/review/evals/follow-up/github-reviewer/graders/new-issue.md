---
type: llm
---
The reply reports, apart from the thread verdicts, that `query()` now releases the client twice on success, once in the `try` and again in the `finally`.
