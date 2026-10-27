---
type: regex
pattern: '(?:compare|regrade|calls|run)\.ts(?![^\n\x60]*--adapter)'
flags: i
match: not_contains
---
The reply does not send anyone to native-only tooling. This case's columns come from another harness, which the eval scripts reach only through `--adapter`.
