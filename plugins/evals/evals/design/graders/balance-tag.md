---
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*(?:tags:(?: ?\[(?:[^\]"\\]|\\.)*\bbalance\b|(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?balance\b)))'
match: contains
---
A case where the artifact should change little is tagged `balance`.
