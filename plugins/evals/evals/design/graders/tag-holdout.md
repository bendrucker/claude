---
type: regex
target: trace
pattern: '(?:"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*(?:tags:(?: ?\[(?:[^\]"\\]|\\.)*\bholdout\b|(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?holdout\b))))|(?:"name":"Edit","input":\{(?=(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"file_path":"(?:[^"\\]|\\.)*case\.yaml")(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"new_string":"(?=[\w ,''\[\]-]*\bholdout\b)[\w ,''\[\]-]*")'
match: contains
---
The session tagged a case `holdout`.
