---
type: regex
target: trace
pattern: '"command":"(?:[^"\\]|\\.)*codesign(?:[^"\\]|\\.)*(\s-s\s+-|--sign\s+-|--remove-signature)'
match: contains
---
The session re-signs a copy of the binary without the hardened runtime (ad-hoc `codesign --force -s -`), which samply needs to attach.
