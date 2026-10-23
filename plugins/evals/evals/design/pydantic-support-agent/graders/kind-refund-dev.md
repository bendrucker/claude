---
type: regex
target: trace
pattern: '(?:"name":"Write","input":\{"file_path":"(?:[^"\\]|\\.)*(?:\.py)","content":"(?=(?:[^"\\]|\\.)*(?:metadata=(?:dict\(|\{)(?=(?:[^}"\\]|\\.)*\brefund\b)(?:[^}"\\]|\\.)*\bdev\b)))|(?:"name":"Write","input":\{"content":"(?=(?:[^"\\]|\\.)*(?:metadata=(?:dict\(|\{)(?=(?:[^}"\\]|\\.)*\brefund\b)(?:[^}"\\]|\\.)*\bdev\b))(?:[^"\\]|\\.)*","file_path":"(?:[^"\\]|\\.)*(?:\.py)")'
match: contains
---
A `refund` case is tagged `dev`.
