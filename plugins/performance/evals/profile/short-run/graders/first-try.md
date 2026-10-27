---
type: regex
target: trace
pattern: '^(?:(?!"command":"(?:[^"\\]|\\.)*samply record)[\s\S])*"command":"(?:[^"\\]|\\.)*samply record(?:[^"\\]|\\.)*(--iteration-count|\s-i\s*\d|--rate|\s-r\s*\d)'
flags: s
match: contains
---
The session's first `samply record` already raised the sample count, with `--iteration-count` or `--rate`, rather than recording one 4 ms run first.
