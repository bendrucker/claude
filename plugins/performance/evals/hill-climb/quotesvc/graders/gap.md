---
type: regex
pattern: '^(?=[^\n]*(?:alloc|heap|memory profile|bytes))(?=[^\n]*(?:latency|p99|tail|time|wait))(?=[^\n]*(?:n''t|\bnot\b|rather than|instead|wrong|mismatch|\bonly\b|proxy|unrelated|says nothing|tells (us )?nothing|measures))'
flags: im
match: contains
---
The profile ranks bytes allocated, which says nothing about where a request waits. The p99 (171 ms) sits near the upstream's 140 ms batch latency while p50 is 1.9 ms and the process uses 0.09 cores: requests queue behind the refresh, which holds the write lock across the upstream fetch.
