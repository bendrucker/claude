---
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*(?:tags:(?: ?\[(?=(?:[^\]"\\]|\\.)*\bselect\b)(?:[^\]"\\]|\\.)*\bholdout\b|(?=(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?select\b)(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?holdout\b)))'
match: contains
---
A `select` case is tagged `holdout`.
