---
type: regex
target: last_message
pattern: "```(bash|sh|zsh|shell|console)\\b"
match: not_contains
---
The final reply hands the user no shell block to run.
