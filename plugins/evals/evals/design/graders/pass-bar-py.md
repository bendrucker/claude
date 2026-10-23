---
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*(?:LLMJudge\((?:(?!pass)(?:[^()]|\([^()]*\)))*\)))'
flags: i
match: not_contains
---
Every `LLMJudge` states a pass bar in its rubric.
