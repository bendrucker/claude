---
type: regex
pattern: '"xml2js": "\^0.6.2"'
match: contains
target: { source: file, path: packages/app/package.json }
---
The app keeps main's xml2js dependency.
