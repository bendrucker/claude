---
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*(?:tags:(?: ?\[(?=(?:[^\]"\\]|\\.)*\bfreeform\b)(?:[^\]"\\]|\\.)*\bdev\b|(?=(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?freeform\b)(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?dev\b)))'
match: contains
---
A `freeform` case is tagged `dev`.
