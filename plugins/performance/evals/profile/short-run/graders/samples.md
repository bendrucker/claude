---
type: regex
target: trace
pattern: '"command":"(?:[^"\\]|\\.)*samply record(?:[^"\\]|\\.)*(--iteration-count|\s-i\s*\d|--rate|\s-r\s*\d)'
match: contains
---
The run lasts about 4 ms, a handful of samples at the default rate, so the session raises the sample count with `--iteration-count` or `--rate`.
