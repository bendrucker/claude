---
type: regex
target: trace
pattern: '"skill":"linear(?::linear)?"'
match: not_contains
arm: both
---
The Linear skill stays out of a request with no Linear in it.
