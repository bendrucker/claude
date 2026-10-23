---
type: regex
target: trace
pattern: '(?:"name":"Write","input":\{"file_path":"(?:[^"\\]|\\.)*(?:\.py)","content":"(?=(?:[^"\\]|\\.)*(?:\bDataset\())(?=(?:[^"\\]|\\.)*(?:\bCase\()))|(?:"name":"Write","input":\{"content":"(?=(?:[^"\\]|\\.)*(?:\bDataset\())(?=(?:[^"\\]|\\.)*(?:\bCase\())(?:[^"\\]|\\.)*","file_path":"(?:[^"\\]|\\.)*(?:\.py)")'
match: contains
---
The session wrote a pydantic-evals `Dataset` of `Case`s to a Python file.
