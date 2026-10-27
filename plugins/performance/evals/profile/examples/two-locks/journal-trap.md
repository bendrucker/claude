---
fail: [cache-first, cache-share, journal-minor]
---
1. `journal_append` (68%): it scans the whole journal while holding the lock, so workers serialize behind it.
2. `route_message` (13%).
