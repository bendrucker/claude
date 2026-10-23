---
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*(?:tags:(?: ?\[(?=(?:[^\]"\\]|\\.)*\bscope\b)(?:[^\]"\\]|\\.)*\bholdout\b|(?=(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?scope\b)(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?holdout\b)))'
match: contains
---
A `scope` case is tagged `holdout`.
