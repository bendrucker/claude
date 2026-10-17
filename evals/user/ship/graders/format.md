---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?\n[ \t>*_-]*in[*_ \t]*:(?:(?!</out>)[\s\S])*?\n[ \t>*_-]*out[*_ \t]*:(?:(?!</out>)[\s\S])*?</out>'
flags: i
match: contains
---
The reply holds the plan between `<out>` tags, with an `in:` line followed by an `out:` line.
