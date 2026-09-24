---
type: regex
pattern: '^```[ \t]*$(?![\s\S]*^```)[\s\S]{500,}'
flags: m
match: not_contains
---
The prose after the last visual stays under 500 characters.
