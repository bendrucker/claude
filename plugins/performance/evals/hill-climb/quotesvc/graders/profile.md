---
type: regex
pattern: '^(?=[^\n]*(?:block(ing)? profil|mutex profil|contention profil|SetBlockProfileRate|SetMutexProfileFraction|go tool trace|execution trace|runtime/trace|\btrace\b|off.?cpu|wall.?clock profil|fgprof|span|per.request (tim|latenc|breakdown)|latency (profil|breakdown|histogram)|(measure|time|instrument)\w*[^\n]{0,40}(lock|wait|refresh|RLock|Get)))'
flags: im
match: contains
---
The next measurement is one that sees where a slow request waits: a block or mutex profile, an execution trace, an off-CPU or wall-clock profile, or per-request timing.
