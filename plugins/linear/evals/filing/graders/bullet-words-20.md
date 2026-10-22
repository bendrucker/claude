---
type: regex
target: trace
pattern: '"description":"(?:[^"\\]|\\.)*?\\n[ \t]*(?:[-*]|\d+\.) (?:\[[ x]\] )?(?:(?:[^"\\\s]|\\[^n])+ +){20}'
match: not_contains
---
Every bullet stays under 20 words.
