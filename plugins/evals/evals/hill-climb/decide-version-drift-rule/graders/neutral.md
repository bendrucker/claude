---
type: regex
pattern: 'compare\.ts(?![^\n\x60]*--adapter)|regrade\.ts|calls\.ts|run\.ts'
flags: i
match: not_contains
---
The reply does not send anyone to native-only tooling. This case's columns come from another harness, which `compare.ts` reads only through `--adapter`.
