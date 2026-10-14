---
type: regex
target: trace
pattern: '\(eval\):[0-9]+: no matches found: --'
match: not_contains
---
zsh did not abort a grep on an unquoted `--include=*.ext` flag. A plain glob that matches nothing is noted rather than rewritten, so it does not count here.
