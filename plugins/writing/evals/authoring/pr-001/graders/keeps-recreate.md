---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?re-?creat\w*'
flags: i
match: contains
---
The body keeps the expected outcome: the resource is dropped from state and recreated if still declared.
