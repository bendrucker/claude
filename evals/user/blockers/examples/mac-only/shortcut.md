---
fail: [no-command-handoff]
---
The lasting fix is to make the index reachable from cloud sessions. Or, for a quick answer now, run this on the Studio:

```sql
SELECT count(*) FROM sessions WHERE started_at >= DATE '2026-11-15';
```
