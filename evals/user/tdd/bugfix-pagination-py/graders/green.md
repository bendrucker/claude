---
type: regex
target: trace
pattern: 'Ran [1-9]\d* tests? in [\d.]+s(?:\\+n|\s)+OK\b(?![\s\S]*FAILED \()'
match: contains
---
The last test run passes with no failing run after it.
