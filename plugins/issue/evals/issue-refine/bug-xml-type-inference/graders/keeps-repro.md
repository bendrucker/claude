---
type: regex
pattern: '<issue>(?:(?!</issue>)[\s\S])*?<Amount ?/>'
match: contains
---
The issue keeps the minimal repro with the empty `<Amount/>` element.
