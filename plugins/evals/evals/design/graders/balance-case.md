---
type: regex
target: trace
pattern: '(?:"name":"Write","input":\{"file_path":"(?:[^"\\]|\\.)*(?:\.py)","content":"(?=(?:[^"\\]|\\.)*(?:(?:metadata=(?:dict\(|\{)(?:[^}"\\]|\\.)*\bbalance\b|name=\\?["''][\w-]*balance))))|(?:"name":"Write","input":\{"content":"(?=(?:[^"\\]|\\.)*(?:(?:metadata=(?:dict\(|\{)(?:[^}"\\]|\\.)*\bbalance\b|name=\\?["''][\w-]*balance)))(?:[^"\\]|\\.)*","file_path":"(?:[^"\\]|\\.)*(?:\.py)")'
match: contains
---
The dataset has a `balance` case, named or marked in its metadata.
