---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(sha-?1|rsa|openssh)'
flags: i
match: contains
---
The body keeps the reason: the default machine image's OpenSSH can no longer authenticate to GitHub over the old RSA/SHA-1 host key.
