---
type: regex
pattern: '^(<<<<<<<|>>>>>>>)( |$)'
flags: m
match: not_contains
target: { source: file, path: packages/app/package.json }
---
package.json holds no conflict markers.
