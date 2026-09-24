---
type: regex
pattern: '^```(?:text|txt|plaintext)?[ \t]*\n(?=(?:(?!```)[\s\S])*?refill)(?=(?:(?!```)[\s\S])*?(?:429|reject|deny|false))'
flags: mi
match: contains
---
The decision appears as pseudocode in a plain block, covering the refill and the rejection.
