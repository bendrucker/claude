---
type: regex
target: trace
pattern: '(?:"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*(?:tags:(?: ?\[(?=(?:[^\]"\\]|\\.)*\bscope\b)(?:[^\]"\\]|\\.)*\bdev\b|(?=(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?scope\b)(?:\\n *- *["'']?[\w-]+["'']?)*?\\n *- *["'']?dev\b))))|(?:"name":"Edit","input":\{(?=(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"file_path":"(?:[^"\\]|\\.)*case\.yaml")(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"new_string":"(?=[\w ,''\[\]-]*\bscope\b)(?=[\w ,''\[\]-]*\bdev\b)[\w ,''\[\]-]*")'
match: contains
---
A `scope` case is tagged `dev`.
