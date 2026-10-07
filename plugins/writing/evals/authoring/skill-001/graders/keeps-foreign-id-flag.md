---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(?:(?:another machine|foreign)[\s\S]{0,200}--machine[\s\S]{0,200}(?:every|each)|--machine[\s\S]{0,200}(?:every|each)[\s\S]{0,200}(?:another machine|foreign))'
flags: i
match: contains
---
IDs repeat across machines, and an ID pulled from another machine's listing needs `--machine <label>` on every command touching it.
