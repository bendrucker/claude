---
type: regex
target: trace
pattern: 'Profiling failed: Could not obtain the root task'
match: not_contains
---
The session got a usable profile on its first recording: it found the hardened runtime and re-signed a copy before recording, rather than after samply failed on the shipped binary.
