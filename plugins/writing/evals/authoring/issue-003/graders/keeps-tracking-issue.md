---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?datadog-api-client-go[\s\S]{0,20}333'
flags: i
match: contains
---
The root cause is tracked as datadog-api-client-go#333.
