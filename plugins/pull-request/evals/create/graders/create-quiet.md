---
type: regex
target: trace
pattern: '"skill":"pull-request:create"'
match: not_contains
---
The request stops short of opening a PR, so the create skill stays quiet.
