---
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*(?:tags:(?: ?\[(?=(?:[^\]"\\]|\\.)*\bfresh\b)(?:[^\]"\\]|\\.)*\bdev\b|(?=(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?fresh\b)(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?dev\b)))'
match: contains
---
A `fresh` case is tagged `dev`.
