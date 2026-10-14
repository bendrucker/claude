---
type: regex
target: trace
pattern: '\(eval\):[0-9]+: no matches found: --'
match: not_contains
---
zsh did not abort a command on an unquoted flag glob such as `--include=*.ts`.
