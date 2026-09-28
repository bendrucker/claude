---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S]){150}'
match: contains
---
The body inside `<out>` runs at least 150 characters, about 40% of the original, catching a draft that collapsed to a stub.
