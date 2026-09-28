---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?404'
flags: i
match: contains
---
The body keeps the 404 detail: the connection is dropped because the API returns not-found on refresh.
