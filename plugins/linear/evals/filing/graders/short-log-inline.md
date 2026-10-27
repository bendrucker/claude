---
type: regex
target: trace
pattern: '"description":"(?:[^"\\]|\\.)*?(?<="description":"|\\n)>>> '
match: not_contains
---
A short trace stays inline rather than folded into a collapsible.
