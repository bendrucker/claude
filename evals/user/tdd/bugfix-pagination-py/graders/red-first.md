---
type: regex
target: trace
pattern: '(?:Edit|Write)\\?",\\?"input\\?":\{(?:\\?"replace_all\\?":(?:true|false),)?\\?"file_path\\?":\\?"[^"\\]*tests/test_pages\.py\\?"[\s\S]*?python3 -m unittest[\s\S]*?FAILED \((?:failures|errors)=[\s\S]*?(?:Edit|Write)\\?",\\?"input\\?":\{(?:\\?"replace_all\\?":(?:true|false),)?\\?"file_path\\?":\\?"[^"\\]*app/pages\.py\\?"'
match: contains
---
A test edit, then a test run that fails, then the first implementation edit after it: the test was seen red before the code changed.
