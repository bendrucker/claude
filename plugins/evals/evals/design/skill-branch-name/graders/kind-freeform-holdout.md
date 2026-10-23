---
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*(?:tags:(?: ?\[(?=(?:[^\]"\\]|\\.)*\bfreeform\b)(?:[^\]"\\]|\\.)*\bholdout\b|(?=(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?freeform\b)(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?holdout\b)))'
match: contains
---
A `freeform` case is tagged `holdout`.
