---
type: regex
target: trace
pattern: '"description":"(?:[^"\\]|\\.)*?\\n```(?:bash|sh|shell|console)?\\n(?:[^`]|\\.)*?bin/invoice-pdf'
match: contains
---
The repro command sits in a fenced shell block.
