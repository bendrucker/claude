---
type: regex
target: trace
pattern: '(?:"name":"Write","input":\{"file_path":"(?:[^"\\]|\\.)*(?:\.py)","content":"(?=(?:[^"\\]|\\.)*(?:metadata=(?:dict\(|\{)(?=(?:[^}"\\]|\\.)*\brefund\b)(?:[^}"\\]|\\.)*\bholdout\b)))|(?:"name":"Write","input":\{"content":"(?=(?:[^"\\]|\\.)*(?:metadata=(?:dict\(|\{)(?=(?:[^}"\\]|\\.)*\brefund\b)(?:[^}"\\]|\\.)*\bholdout\b))(?:[^"\\]|\\.)*","file_path":"(?:[^"\\]|\\.)*(?:\.py)")'
match: contains
---
A `refund` case is tagged `holdout`.
