---
type: regex
pattern: '"node_modules/xml2js": \{\s*"version": "0\.6\.2"'
flags: s
match: contains
target: { source: file, path: packages/app/package-lock.json }
---
main's locked xml2js 0.6.2 survives.
