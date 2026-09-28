---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?GetOk'
match: contains
---
The draft keeps the `GetOk` fact: it still reports the field as set even when the value is unknown.
