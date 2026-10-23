---
type: regex
pattern: '^\s{0,3}(\*\*)?\d[.)](?![^\n]*(parallel|pool|worker|idle|unused|dispatch|concurr|spread))[^\n]*(cvwait|cond_wait|nanosleep|semwait|ulock_wait|pthread_join|metrics_flusher)'
flags: im
match: not_contains
---
No lead is an idle thread's wait (`__psynch_cvwait`, `nanosleep`, `pthread_join`) presented as a cost.
