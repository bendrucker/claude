---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(?:(?:author|writing (?:a module|modules))[\s\S]{0,100}(?:quirk|this|it\b)|(?:quirk|this|it\b)[\s\S]{0,100}(?:author|writing (?:a module|modules)))'
flags: i
match: contains
---
The body keeps the payoff: module authors no longer need to know about the quirk themselves.
