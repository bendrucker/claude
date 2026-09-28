---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(?:(?=[\s\S]*#6\b)#7\b|(?=[\s\S]*#7\b)#6\b)'
flags: i
match: contains
---
Both closed issues (#7 and #6) are kept, in either order.
