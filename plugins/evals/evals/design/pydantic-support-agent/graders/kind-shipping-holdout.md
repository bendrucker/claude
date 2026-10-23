---
type: regex
target: trace
pattern: '(?:"name":"Write","input":\{"file_path":"(?:[^"\\]|\\.)*(?:\.py)","content":"(?=(?:[^"\\]|\\.)*(?:metadata=(?:dict\(|\{)(?=(?:[^}"\\]|\\.)*\bshipping\b)(?:[^}"\\]|\\.)*\bholdout\b)))|(?:"name":"Write","input":\{"content":"(?=(?:[^"\\]|\\.)*(?:metadata=(?:dict\(|\{)(?=(?:[^}"\\]|\\.)*\bshipping\b)(?:[^}"\\]|\\.)*\bholdout\b))(?:[^"\\]|\\.)*","file_path":"(?:[^"\\]|\\.)*(?:\.py)")'
match: contains
---
A `shipping` case is tagged `holdout`.
