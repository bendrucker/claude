---
type: regex
target: trace
pattern: '"command":"[^"]*\bcat\b[^"]*notes\.md[\s\S]*Release checklist\\n===\\nBuild every \*\.ts file\\nShip'
match: contains
---
A later `cat` of `notes.md` shows the body exactly as written.
