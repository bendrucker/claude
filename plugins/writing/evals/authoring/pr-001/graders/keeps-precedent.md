---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?pagerduty_service'
flags: i
match: contains
---
The body keeps the precedent: `pagerduty_service` already handles removal the same way.
