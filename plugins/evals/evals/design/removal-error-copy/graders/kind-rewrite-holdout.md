---
type: regex
target: trace
pattern: '(?:"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*(?:tags:(?: ?\[(?=(?:[^\]"\\]|\\.)*\brewrite\b)(?:[^\]"\\]|\\.)*\bholdout\b|(?=(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?rewrite\b)(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?holdout\b))))|(?:"name":"Edit","input":\{(?=(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"file_path":"(?:[^"\\]|\\.)*case\.yaml")(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"new_string":"(?=[\w ,''\[\]-]*\brewrite\b)(?=[\w ,''\[\]-]*\bholdout\b)[\w ,''\[\]-]*")'
match: contains
---
A `rewrite` case is tagged `holdout`.
