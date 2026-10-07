---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(const\s+)?Bluebird\s*=\s*require\([`''"]bluebird[`''"]\)'
flags: i
match: contains
---
The breaking-change alternative of naming the import `const Bluebird = require('bluebird')`.
