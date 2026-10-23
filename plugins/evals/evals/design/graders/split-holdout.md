---
type: regex
target: trace
pattern: '(?:"name":"Write","input":\{"file_path":"(?:[^"\\]|\\.)*(?:\.py)","content":"(?=(?:[^"\\]|\\.)*(?:metadata=(?:dict\(|\{)(?:[^}"\\]|\\.)*\bholdout\b)))|(?:"name":"Write","input":\{"content":"(?=(?:[^"\\]|\\.)*(?:metadata=(?:dict\(|\{)(?:[^}"\\]|\\.)*\bholdout\b))(?:[^"\\]|\\.)*","file_path":"(?:[^"\\]|\\.)*(?:\.py)")'
match: contains
---
A `Case` in the dataset carries `holdout` in its metadata.
