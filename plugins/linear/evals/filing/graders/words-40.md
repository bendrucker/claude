---
type: regex
target: trace
pattern: '"description":"(?:(?:[^"\\\s]|\\[^n])+(?:\s|\\n)+){40}'
match: not_contains
---
The description stays under 40 words.
