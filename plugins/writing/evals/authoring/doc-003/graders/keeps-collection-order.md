---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?((order|remov|splic)[\s\S]{0,150}(undesire|unexpect|incorrect|break|corrupt)|(undesire|unexpect|incorrect|break|corrupt)[\s\S]{0,150}(order|remov|splic))'
flags: i
match: contains
---
Modifying collection order or removing entries directly is called out as unsafe.
