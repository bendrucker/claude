---
type: regex
target: trace
pattern: '(?:Edit|Write)\\?",\\?"input\\?":\{(?:\\?"replace_all\\?":(?:true|false),)?\\?"file_path\\?":\\?"[^"\\]*src/settings\.test\.ts\\?"[\s\S]*?bun test[\s\S]*?\b[1-9]\d* (?:fail|errors?)\b[\s\S]*?(?:Edit|Write)\\?",\\?"input\\?":\{(?:\\?"replace_all\\?":(?:true|false),)?\\?"file_path\\?":\\?"[^"\\]*src/settings\.ts\\?"'
match: contains
---
A test edit, then a test run that fails, then the first implementation edit after it: the test was seen red before the code changed.
