---
type: regex
target: trace
pattern: '^(?![\s\S]*Shell command failed for pattern)[\s\S]*Base directory for this skill: \S*pull-request/skills/create'
match: contains
arm: with-only
---
The create skill's body reached the session with every `!` context command succeeding. It fails when the skill never fired.
