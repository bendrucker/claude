---
type: regex
pattern: '^(<<<<<<<|>>>>>>>)( |$)'
flags: m
match: not_contains
target: { source: file, path: packages/app/package-lock.json }
---
The lockfile holds no conflict markers.
