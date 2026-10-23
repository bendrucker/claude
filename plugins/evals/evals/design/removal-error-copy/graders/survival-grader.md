---
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*type: regex)(?!(?:[^"\\]|\\.)*not_contains)(?=(?:[^"\\]|\\.)*E-|error code)'
flags: i
match: contains
---
A grader without `not_contains` checks the fact the removal must leave in place.
