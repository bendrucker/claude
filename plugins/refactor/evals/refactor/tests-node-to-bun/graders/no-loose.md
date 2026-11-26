---
type: regex
target: { source: file, path: test/ini.test.ts }
pattern: 'toBeTruthy|toBeDefined|toMatchSnapshot|toMatchInlineSnapshot|toThrow\(\)'
match: not_contains
---
No assertion was loosened to a truthiness check, a bare `toThrow()`, or a snapshot of the new output.
