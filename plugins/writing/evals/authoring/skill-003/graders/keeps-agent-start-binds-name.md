---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(only\s+`?agent start`?\s+binds|binds\s+a\s+name[\s\S]{0,80}agent start)'
flags: i
match: contains
---
Only `agent start` binds a name; it does not gate `agent get`/`read`/`wait`.
