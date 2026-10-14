---
type: regex
target: trace
pattern: '\(eval\):[0-9]+: \S+ not found(?!:)'
match: not_contains
---
zsh did not run an `===` separator as an `=` command path.
