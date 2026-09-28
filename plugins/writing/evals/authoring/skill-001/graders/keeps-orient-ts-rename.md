---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(?:orient\.ts[\s\S]{0,1200}machine list|machine list[\s\S]{0,1200}orient\.ts)'
flags: i
match: contains
---
The allowed-tools list and the bang-execution line both point at `orient.ts`, and allowed-tools gains `herdr machine list`.
