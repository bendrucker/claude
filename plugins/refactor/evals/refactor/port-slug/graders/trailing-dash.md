---
type: llm
---
`bin/slug` emits a trailing `-` (from the newline `echo` adds), and `bin/tag-release` depends on it to separate the slug from the date. The session either reproduces the trailing dash in `bin/slug.ts`, or keeps the new version without it and tells the user in the final reply that this changes behavior that `bin/tag-release` depends on. Fail when the TypeScript version drops the trailing dash and the reply calls the port equivalent or does not mention the difference.
