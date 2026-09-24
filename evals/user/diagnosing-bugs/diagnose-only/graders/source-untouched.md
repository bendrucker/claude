---
type: regex
target: { source: file, path: src/config.ts }
pattern: '\{ \.\.\.user, \.\.\.fromEnv\(\), \.\.\.defaults \}'
---
The buggy merge is still in place, since the user asked for no changes.
