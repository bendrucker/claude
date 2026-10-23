---
type: regex
pattern: '^\s{0,3}(\*\*)?1[.)][^\n]*(cache_get|cache_lock|cache lock|cache mutex)'
flags: im
match: contains
---
The first lead is contention on the cache lock taken in `cache_get`, which holds most of the lock wait despite its tiny critical section.
