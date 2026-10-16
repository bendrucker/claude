---
type: regex
pattern: '^\s{0,3}[12][.)](?![^\n]*(?:lock|mutex|refresh|singleflight|copy.on.write|atomic|swap|stale|contention|block|upstream|fetch|trace|off.?cpu|wait))[^\n]*(?:json|Encode|marshal|Sprintf|\bcents\b|strconv|Itoa|sync\.Pool|\bpool|alloc|bufio|buffer|\bGC\b|garbage|Header\.Set|parseQuery|Query\(\)|time\.Format|Format)'
flags: im
match: not_contains
---
Neither of the first two candidates is a CPU micro-optimization the profile over-ranks: json, sprintf, alloc.
