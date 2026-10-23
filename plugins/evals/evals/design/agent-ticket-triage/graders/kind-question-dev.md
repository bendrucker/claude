---
type: regex
target: trace
pattern: '(?:"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*(?:tags:(?: ?\[(?=(?:[^\]"\\]|\\.)*\bquestion\b)(?:[^\]"\\]|\\.)*\bdev\b|(?=(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?question\b)(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?dev\b))))|(?:"name":"Edit","input":\{(?=(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"file_path":"(?:[^"\\]|\\.)*case\.yaml")(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"new_string":"(?=[\w ,''\[\]-]*\bquestion\b)(?=[\w ,''\[\]-]*\bdev\b)[\w ,''\[\]-]*")'
match: contains
---
A `question` case is tagged `dev`.
