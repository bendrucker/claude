---
type: regex
target: trace
pattern: '"description":"(?:[^"\\]|\\.)*?\\n- \[ \] '
match: not_contains
---
A request that supplies no criteria or tasks gets no check list.
