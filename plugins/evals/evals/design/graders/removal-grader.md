---
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*(?:match: ?\\?["'']?not_contains))'
match: contains
---
A grader fails a reply for containing the text the change removes.
