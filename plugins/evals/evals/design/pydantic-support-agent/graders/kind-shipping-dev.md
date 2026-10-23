---
type: regex
target: trace
pattern: '(?:"name":"Write","input":\{"file_path":"(?:[^"\\]|\\.)*(?:\.py)","content":"(?=(?:[^"\\]|\\.)*(?:metadata=(?:dict\(|\{)(?=(?:[^}"\\]|\\.)*\bshipping\b)(?:[^}"\\]|\\.)*\bdev\b)))|(?:"name":"Write","input":\{"content":"(?=(?:[^"\\]|\\.)*(?:metadata=(?:dict\(|\{)(?=(?:[^}"\\]|\\.)*\bshipping\b)(?:[^}"\\]|\\.)*\bdev\b))(?:[^"\\]|\\.)*","file_path":"(?:[^"\\]|\\.)*(?:\.py)")'
match: contains
---
A `shipping` case is tagged `dev`.
