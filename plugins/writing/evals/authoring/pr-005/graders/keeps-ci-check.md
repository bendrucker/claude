---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(check.{0,20}fail|fail.{0,20}check|out.of.date.{0,30}fail)'
flags: i
match: contains
---
The body keeps the enforcement: a workflow check fails when the generated docs are out of date.
