---
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*(?:tags:(?: ?\[(?:[^\]"\\]|\\.)*\bquiet\b|(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?quiet\b)))'
match: contains
---
A case where the artifact should stay quiet is tagged `quiet`.
