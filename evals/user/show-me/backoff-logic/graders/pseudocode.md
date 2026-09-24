---
type: regex
pattern: '^```(?:text|txt|plaintext)?[ \t]*\n(?=(?:(?!```)[\s\S])*?(?:give.?up|graveyard))(?=(?:(?!```)[\s\S])*?(?:2\s*\^|\*\*|doubl|jitter))'
flags: mi
match: contains
---
The decision appears as pseudocode in a plain block, covering the backoff and the give-up.
