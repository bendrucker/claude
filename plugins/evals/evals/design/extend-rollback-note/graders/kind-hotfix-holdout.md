---
type: regex
target: trace
pattern: '(?:"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*(?:tags:(?: ?\[(?=(?:[^\]"\\]|\\.)*\bhotfix\b)(?:[^\]"\\]|\\.)*\bholdout\b|(?=(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?hotfix\b)(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?holdout\b))))|(?:"name":"Edit","input":\{(?=(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"file_path":"(?:[^"\\]|\\.)*case\.yaml")(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"new_string":"(?=[\w ,''\[\]-]*\bhotfix\b)(?=[\w ,''\[\]-]*\bholdout\b)[\w ,''\[\]-]*")'
match: contains
---
A `hotfix` case is tagged `holdout`.
