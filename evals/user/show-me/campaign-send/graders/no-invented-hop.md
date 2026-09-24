---
type: regex
pattern: '^```mermaid(?:(?!```)[\s\S])*?^\s*(?:worker|mailer)\w*\s*-{1,2}[>)x]{1,2}[+-]?\s*(?:api|admin)'
flags: mi
match: not_contains
---
The diagram keeps the real progress path through Redis, with no arrow from the worker straight to the API or the admin page.
