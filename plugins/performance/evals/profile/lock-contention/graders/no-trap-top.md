---
type: regex
pattern: '^\s{0,3}(\*\*)?1[.)](?![^\n]*(lock|mutex|contention|percentile_refresh|stats_record))[^\n]*score_item'
flags: im
match: not_contains
---
The first lead is not `score_item`, the largest CPU entry outside the lock (about 11%).
