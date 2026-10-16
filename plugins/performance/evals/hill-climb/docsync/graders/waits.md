---
type: regex
target: { source: file, path: bench/CLIMB.md }
pattern: '^(?=[^\n]*(\bwait|who (runs|waits)))[^\n]*(maintainer|release|by hand|person|human|\bPR\b|user)'
flags: im
match: contains
---
The notes record who waits on the sync: a maintainer, after each upstream release.
