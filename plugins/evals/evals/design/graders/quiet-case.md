---
type: regex
target: trace
pattern: '(?:"name":"Write","input":\{"file_path":"(?:[^"\\]|\\.)*(?:\.py)","content":"(?=(?:[^"\\]|\\.)*(?:(?:metadata=(?:dict\(|\{)(?:[^}"\\]|\\.)*\bquiet\b|name=\\?["''][\w-]*quiet))))|(?:"name":"Write","input":\{"content":"(?=(?:[^"\\]|\\.)*(?:(?:metadata=(?:dict\(|\{)(?:[^}"\\]|\\.)*\bquiet\b|name=\\?["''][\w-]*quiet)))(?:[^"\\]|\\.)*","file_path":"(?:[^"\\]|\\.)*(?:\.py)")'
match: contains
---
The dataset has a `quiet` case, named or marked in its metadata.
