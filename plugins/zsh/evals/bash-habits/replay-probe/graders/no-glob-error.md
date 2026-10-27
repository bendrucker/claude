---
type: regex
target: trace
pattern: '\(eval\):[0-9]+: no match'
match: not_contains
---
zsh ran every command instead of skipping one on a glob with no match.
