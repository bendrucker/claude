---
type: regex
pattern: '^```mermaid(?=(?:(?!```)[\s\S])*?redis)(?=(?:(?!```)[\s\S])*?\bses\b)(?=(?:(?!```)[\s\S])*?(?:worker|mailer))'
flags: mi
match: contains
---
The diagram includes Redis, the mailer worker, and SES.
