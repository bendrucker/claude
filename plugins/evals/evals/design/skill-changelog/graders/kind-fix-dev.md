---
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*(?:tags:(?: ?\[(?=(?:[^\]"\\]|\\.)*\bfix\b)(?:[^\]"\\]|\\.)*\bdev\b|(?=(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?fix\b)(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?dev\b)))'
match: contains
---
A `fix` case is tagged `dev`.
