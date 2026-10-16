---
type: regex
pattern: '^(?=[^\n]*(?:off.?cpu|trace|wall.?clock profil|block(ing)? profil|fgprof|strace|dtruss|perf (trace|sched)|syscall (trac|count|profil|tim)|fs_usage|iostat|offcputime|bpftrace|instrument|time (each|every|the) (phase|step|fsync|sync|write)|(measure|count|instrument)\w*[^\n]{0,40}(fsync|\bsync\b|wait|block|i/o)))'
flags: im
match: contains
---
The next measurement is one that sees waiting: an off-CPU or wall-clock profile, a syscall trace, or timing the fsync calls.
