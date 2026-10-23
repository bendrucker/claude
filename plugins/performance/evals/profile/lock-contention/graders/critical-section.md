---
type: regex
pattern: '^(?=[^\n]*percentile_refresh)(?=[^\n]*(lock|mutex|critical section|holding|\bheld\b|\bunder\b))'
flags: im
match: contains
---
The work done while holding the lock is `percentile_refresh`, which rescans the histogram on every event, and the reply ties it to the lock.
