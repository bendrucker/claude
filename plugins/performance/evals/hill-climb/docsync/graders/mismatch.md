---
type: regex
target: { source: file, path: bench/CLIMB.md }
pattern: '^(?=[^\n]*(bench|harness|hyperfine|fixture))(?=[^\n]*(no-?op|up[- ]to[- ]date|unchanged|nothing (changed|to fetch|to do|to sync)|skip|short-?circuit|early (exit|return)|exits? (early|before)|never (fetch|reach|run|appl)|lock\w*[^\n]{0,40}match|zero (packages|changes)|0 of \d+))[^\n]*(fetch|apply|133|two minutes|2 ?min|\b2m\b)'
flags: im
match: contains
---
The notes flag that the `bench/` harness times the up-to-date exit, which skips the fetch and apply a maintainer waits through.
