---
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*type: llm)(?!(?:[^"\\]|\\.)*pass)'
flags: i
match: not_contains
---
Every `llm` grader the session wrote states a pass bar.
