---
type: regex
target: trace
pattern: '"description":"(?:(?:[^"\\\s]|\\[^n])+(?:\s|\\n)+){200}'
match: not_contains
---
The description stays under 200 words.
