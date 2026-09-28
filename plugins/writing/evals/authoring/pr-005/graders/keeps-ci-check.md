---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(check.{0,150}fail|fail.{0,150}check|out.of.date.{0,30}fail|fail.{0,80}(?:differ|drift|out of sync|shows a difference)|(?:differ|drift|out of sync|shows a difference).{0,80}fail)'
flags: i
match: contains
---
The body keeps the enforcement: a workflow check fails when the generated docs are out of date.
