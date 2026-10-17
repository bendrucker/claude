---
type: regex
target: { source: file, path: bench/CLIMB.md }
pattern: '^#{1,6}[ \t][^\n]*\brules\b[^\n]*\n(?:(?!#{1,6}[ \t])[^\n]*\n)*?(?=[^\n]*(?:budget))[^\n]*\bassumed[*_`)]*\s*:'
flags: im
match: contains
weight: 0.125
---
A Rules line marks the budget, which the brief leaves open, as `assumed: <value>`.
