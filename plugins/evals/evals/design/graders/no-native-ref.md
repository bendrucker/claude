---
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"[a-z_]+":"(?=(?:[^"\\]|\\.)*(?:evals/native))'
match: not_contains
---
Nothing the session wrote or edited names `evals/native`, which only runs native suites.
