---
type: regex
target: trace
pattern: '"name":"(?:Write|Edit)","input":\{(?:"[a-z_]+":(?:"(?:[^"\\]|\\.)*"|true|false),)*?"(?:content|new_string)":"(?=(?:[^"\\]|\\.)*(?:LLMJudge\((?:(?!\bmodel=)(?:[^()]|\([^()]*\)))*\)|LLMJudge\((?:[^()]|\([^()]*\))*?\bmodel=\\?["'']anthropic:claude-sonnet-5-5))'
match: not_contains
---
Every `LLMJudge` sets `model=` to something other than the agent's model.
