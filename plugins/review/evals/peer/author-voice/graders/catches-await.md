---
type: regex
pattern: '<comments>(?:(?!</comments>)[\s\S])*?\bawait'
flags: i
match: contains
---
The comments flag that `retry` returns `fn()` without awaiting it, so a rejection escapes the `catch` and is never retried.
