---
type: regex
target: trace
pattern: '\b[1-9]\d* pass(?:\\+n|\s)+0 fail\b(?![\s\S]*\b[1-9]\d* fail\b)'
match: contains
---
The last test run passes with no failing run after it.
