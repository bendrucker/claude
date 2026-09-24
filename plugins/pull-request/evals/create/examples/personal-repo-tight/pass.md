---
fail: []
---
Title: backoff: use full jitter and a 20s cap

Synchronized retries were piling onto the upstream after an outage, so the backoff now uses full jitter to spread them out, with the cap raised to 20s. p99 dropped from 410ms to 230ms.

Original Task: things:///show?id=Fk3aX2mQ
