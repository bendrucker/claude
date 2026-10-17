---
type: regex
pattern: '^\s*(?:export\s+)?(?:(?:async\s+)?function\s+)?\w+\??\([^)\n]*\)\s*:\s*[^{\n=]+;?\s*$'
flags: m
match: contains
---
The design shows at least one signature without a body.
