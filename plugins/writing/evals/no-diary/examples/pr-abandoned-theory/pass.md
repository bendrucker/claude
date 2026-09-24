---
fail: []
---
<rewrite>
Fixes a retry bug caused by `spawn` being awaited before the output stream drained, which made the exit event fire against a closed handle. The await now happens after the stream drains. The timeout path had the same bug and is fixed the same way.
</rewrite>

Cut per `writing:no-diary`:
- **Change evolution** — the abandoned "status check in `run()`" theory, and sequencing words like "initially," "turned out," "along the way."
- **Verification framing** — dropped "all tests pass (47 passing)"; a test count isn't a result worth keeping.
