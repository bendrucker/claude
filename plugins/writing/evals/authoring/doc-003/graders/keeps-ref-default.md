---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(\$path(?:(?!</out>)[\s\S]){0,150}?false(?:(?!</out>)[\s\S]){0,150}?collection|collection(?:(?!</out>)[\s\S]){0,150}?false(?:(?!</out>)[\s\S]){0,150}?\$path)'
flags: i
match: contains
---
`$ref`'s default path logic (`$path(false)` with a collection, `$path(true)` otherwise) is kept.
