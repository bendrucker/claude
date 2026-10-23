---
type: regex
target: trace
pattern: '(?:"name":"Write","input":\{"file_path":"(?:[^"\\]|\\.)*(?:\.py)","content":"(?=(?:[^"\\]|\\.)*(?:\b(?:Contains|Equals|EqualsExpected|IsInstance|MaxDuration|HasMatchingSpan)\(|\(Evaluator\))))|(?:"name":"Write","input":\{"content":"(?=(?:[^"\\]|\\.)*(?:\b(?:Contains|Equals|EqualsExpected|IsInstance|MaxDuration|HasMatchingSpan)\(|\(Evaluator\)))(?:[^"\\]|\\.)*","file_path":"(?:[^"\\]|\\.)*(?:\.py)")'
match: contains
---
The dataset grades with a deterministic evaluator before any judge.
