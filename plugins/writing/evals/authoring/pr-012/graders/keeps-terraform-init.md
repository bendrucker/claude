---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?terraform\s+init'
flags: i
match: contains
---
The draft keeps the earlier, cleaner failure point: `terraform init`.
