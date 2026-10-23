---
type: regex
target: trace
pattern: '(?:"name":"Write","input":\{"file_path":"(?:[^"\\]|\\.)*(?:/(?:fixtures?/(?:[^"\\]|\\.)*|(?:fixtures?|scaffold|setup|repo)[^"/\\]*))","content":"(?=(?:[^"\\]|\\.)*(?:type: (?:regex|llm|tool_used|file_exists)|\bgraders?\b|\bpass bar\b|\bpattern:)))|(?:"name":"Write","input":\{"content":"(?=(?:[^"\\]|\\.)*(?:type: (?:regex|llm|tool_used|file_exists)|\bgraders?\b|\bpass bar\b|\bpattern:))(?:[^"\\]|\\.)*","file_path":"(?:[^"\\]|\\.)*(?:/(?:fixtures?/(?:[^"\\]|\\.)*|(?:fixtures?|scaffold|setup|repo)[^"/\\]*))")'
flags: i
match: not_contains
---
No fixture the session wrote holds grader text, since a Read or Grep in the case's working directory would find it.
