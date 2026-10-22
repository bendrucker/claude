---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n)[\s\S])*?^title:[^\n]*(?:`|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b\w+\.(?:ts|tsx|js|py|go|rb|sql|yaml|yml|json)\b|\w\(\))'
flags: m
match: not_contains
---
The title names the problem or outcome, with no code identifier: no backticks, env var, file name, or function call.
