---
type: regex
target: trace
pattern: '\(eval\):[0-9]+: no matches found'
match: not_contains
---
zsh did not abort the grep on its unquoted --include glob.
