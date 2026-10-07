---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(const\s+)?Promise\s*=\s*require\([`''"]bluebird[`''"]\)'
flags: i
match: contains
---
The still-allowed option of shadowing Promise with `const Promise = require('bluebird')`.
