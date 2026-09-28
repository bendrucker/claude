---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?async.{0,10}await'
flags: i
match: contains
---
Growing use of async/await is the motivation for allowing the Promise global.
