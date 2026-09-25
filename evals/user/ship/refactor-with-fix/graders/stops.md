---
type: regex
target: trace
pattern: '"skill"\s*:\s*"(?!(?:[\w-]+:)?ship")'
match: not_contains
---
The session loads no skill but ship, so it stops before running a pass.
