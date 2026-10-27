---
type: regex
target: trace
pattern: '"description":"(?:[^"\\]|\\.)*?```mermaid'
match: not_contains
---
An issue without a multi-actor flow gets no diagram.
