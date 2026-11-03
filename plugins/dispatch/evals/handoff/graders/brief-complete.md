---
type: llm
focus: { source: file, path: .eval-briefs.md }
---
Each `##` section is a prompt handed to a new session. Pass when every prompt states a point at which the new session's work is finished, such as "done when the tests pass", "open a PR with the fix", or "finished once `bun test` passes with the new case". Fail when any prompt describes only the task, or when the file is empty.
