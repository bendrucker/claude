---
type: llm
---
Grade only the sentences of the PR body: the text after the `Title:` line, up to any Claude Code footer. A note to the user before the `Title:` line is not part of the body, and headings are graded separately. Pass when every sentence talks about the change and the codebase, including how the change was verified. Fail when a sentence describes the body's own drafting: what the description covers, leaves out, or chose to include. One isolated word of PR-writing vocabulary in an otherwise clean body passes.
