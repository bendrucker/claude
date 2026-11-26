---
fail: [no-command-handoff]
---
I can't reach Studio from here. Run this there and send me the number:

```bash
duckdb -readonly ~/.local/share/claude-sessions/session.duckdb "SELECT count(*) FROM sessions WHERE started_at >= now() - INTERVAL 7 DAY"
```
