---
type: regex
pattern: '^(?=[^\n]*(journal_append|journal_lock|journal lock|journal mutex))(?=[^\n]*\b([4-9]|1[0-6])(\.\d+)?\s?%)'
flags: im
match: contains
---
The journal lock, whose critical section scans the journal, accounts for only about 10% of samples waiting. The reply separates it from the cache lock's wait with its own small share.
