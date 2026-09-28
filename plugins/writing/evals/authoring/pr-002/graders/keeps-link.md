---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?discuss\.circleci\.com'
flags: i
match: contains
---
The body keeps the link to the CircleCI discussion the change is based on.
