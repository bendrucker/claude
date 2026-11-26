---
type: regex
target: last_message
pattern: "```(bash|sh|zsh|shell|console|sql)\\b"
match: not_contains
---
The final reply hands the user no shell or query block to run.
