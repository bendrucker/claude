---
type: regex
target: { source: file, path: bench/CLIMB.md }
pattern: '^(?=[^\n]*(bench|harness|hyperfine|fixture))(?=[^\n]*(no-?op|up[- ]to[- ]date|unchanged|skip|short-?circuit|never (fetch|reach|run)|lock\w*[^\n]{0,40}match))[^\n]*(fetch|apply|133|two minutes)'
flags: im
match: contains
---
The notes flag that the `bench/` harness times the up-to-date exit, which skips the fetch and apply a maintainer waits through.
