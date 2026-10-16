---
type: regex
target: { source: file, path: bench/CLIMB.md }
pattern: '^#{1,6}\s[^\n]*checkpoint[^\n]*\n+(#{1,6}\s[^\n]*\n+)*[^#\s]'
flags: im
match: contains
---
The notes file holds a Checkpoint section with content under it.
