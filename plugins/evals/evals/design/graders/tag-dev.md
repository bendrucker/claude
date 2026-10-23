---
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*(?:tags:(?: ?\[(?:[^\]"\\]|\\.)*\bdev\b|(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?dev\b)))'
match: contains
---
The session tagged a case `dev`.
