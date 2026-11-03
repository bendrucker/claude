---
type: llm
focus: { source: file, path: .eval-briefs.md }
---
The file holds one or more prompts handed to new sessions. Each prompt starts after a `=== prompt for <name> ===` line and runs to the next such line, and any headings inside it belong to that prompt. Pass when every prompt states anywhere in its text a point at which the new session's work is finished, such as "done when the tests pass", "then open a PR", or "finished once `bun test` passes with the new case". Fail when any prompt describes only the task, or when the file is empty.
