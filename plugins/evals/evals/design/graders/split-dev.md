---
type: regex
target: trace
pattern: '(?:"name":"Write","input":\{"file_path":"(?:[^"\\]|\\.)*(?:\.py)","content":"(?=(?:[^"\\]|\\.)*(?:metadata=(?:dict\(|\{)(?:[^}"\\]|\\.)*\bdev\b)))|(?:"name":"Write","input":\{"content":"(?=(?:[^"\\]|\\.)*(?:metadata=(?:dict\(|\{)(?:[^}"\\]|\\.)*\bdev\b))(?:[^"\\]|\\.)*","file_path":"(?:[^"\\]|\\.)*(?:\.py)")'
match: contains
---
A `Case` in the dataset carries `dev` in its metadata.
