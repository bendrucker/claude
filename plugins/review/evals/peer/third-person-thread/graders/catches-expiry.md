---
type: regex
pattern: '<comments>(?:(?!</comments>)[\s\S])*?\bisExpired'
match: contains
---
The comments flag that `isExpired` returns true for a fresh entry, so the cache is never read and stale rates are never refreshed out of it.
