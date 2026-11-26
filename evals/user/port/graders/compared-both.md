---
type: llm
---
Before reporting the port done, the session ran the original script and the new TypeScript version on the same inputs and compared their stdout, stderr, and exit status, using at least one input beyond the happy path (empty input, a missing file, or an edge the original handles specially). Running only the new version, running only the test suite, or comparing by reading the code fails. For example, a session that writes a loop feeding three fixture files to both `bin/summarize` and `bun bin/summarize.ts` and diffs the results passes.
