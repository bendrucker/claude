---
type: regex
pattern: '^```[ \t]*$(?![\s\S]*^```)[\s\S]{800,}'
flags: m
match: not_contains
---
The prose after the last visual stays under 800 characters.
