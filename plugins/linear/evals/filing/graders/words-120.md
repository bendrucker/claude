---
type: regex
target: trace
pattern: '"description":"(?:(?:[^"\\\s]|\\[^n])+(?:\s|\\n)+){120}'
match: not_contains
---
The description stays under 120 words.
