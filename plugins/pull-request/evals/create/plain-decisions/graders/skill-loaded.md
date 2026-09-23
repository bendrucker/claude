---
type: regex
target: trace
pattern: 'Shell command failed for pattern'
match: not_contains
arm: with-only
---
Every `!` context command in the skill ran, so the skill body reached the session.
