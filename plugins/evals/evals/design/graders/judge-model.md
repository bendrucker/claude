---
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*(?:judge_model: ?\\?["'']?claude-(?!sonnet-5-5\b)))'
match: contains
---
A `suite.yaml` sets `judge_model` to a model other than the one under test.
