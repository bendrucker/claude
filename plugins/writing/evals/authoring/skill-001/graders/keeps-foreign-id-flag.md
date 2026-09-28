---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(?:(?:repeat|the same id|shares (?:that|an) id)[\s\S]{0,400}--machine[\s\S]{0,150}(?:every|each)|(?:every|each)[\s\S]{0,150}--machine[\s\S]{0,400}(?:repeat|the same id|shares (?:that|an) id)|--machine[\s\S]{0,150}(?:every|each)[\s\S]{0,400}(?:repeat|the same id|shares (?:that|an) id))'
flags: i
match: contains
---
IDs repeat across machines, and an ID pulled from another machine's listing needs `--machine <label>` on every command touching it.
