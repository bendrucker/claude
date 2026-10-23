---
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*(?:tags:(?: ?\[(?:[^\]"\\]|\\.)*\bholdout\b|(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?holdout\b)))'
match: contains
---
The session tagged a case `holdout`.
