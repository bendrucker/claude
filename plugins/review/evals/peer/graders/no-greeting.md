---
type: regex
pattern: '<comments>(?:(?!</comments>)[\s\S])*?(?:^|\n)\W*(?:hi|hey|hello|thanks|thank you)\b'
flags: i
match: not_contains
---
No comment opens with a greeting or thanks.
