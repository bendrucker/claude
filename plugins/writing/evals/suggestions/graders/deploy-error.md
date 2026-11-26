---
type: regex
target: { source: file, path: docs/deploy.rst }
pattern: '\s—\s'
match: not_contains
---
The spaced em dash the error flagged is gone.
