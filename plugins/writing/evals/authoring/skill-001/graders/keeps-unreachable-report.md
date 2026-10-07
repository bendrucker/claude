---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(?:unreachable[\s\S]{0,300}(?:SSH|hostname|target)|(?:SSH|hostname|target)[\s\S]{0,300}unreachable)'
flags: i
match: contains
---
A connection failure is reported as the machine being unreachable rather than by quoting herdr's raw error, which would name the SSH target.
