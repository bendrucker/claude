---
type: regex
target: trace
pattern: '(?:Edit|Write)\\?",\\?"input\\?":\{(?:\\?"replace_all\\?":(?:true|false),)?\\?"file_path\\?":\\?"[^"\\]*src/money\.test\.ts\\?"[\s\S]*?(?:Edit|Write)\\?",\\?"input\\?":\{(?:\\?"replace_all\\?":(?:true|false),)?\\?"file_path\\?":\\?"[^"\\]*src/money\.ts\\?"[\s\S]*?(?:Edit|Write)\\?",\\?"input\\?":\{(?:\\?"replace_all\\?":(?:true|false),)?\\?"file_path\\?":\\?"[^"\\]*src/money\.test\.ts\\?"[\s\S]*?(?:Edit|Write)\\?",\\?"input\\?":\{(?:\\?"replace_all\\?":(?:true|false),)?\\?"file_path\\?":\\?"[^"\\]*src/money\.ts\\?"'
match: contains
---
Tests and implementation alternate at least twice (test, code, test, code) rather than every test landing before any code.
