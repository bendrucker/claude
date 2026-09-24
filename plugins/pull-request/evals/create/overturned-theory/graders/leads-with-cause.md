---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line, such as a note that the push or create command failed. The first sentence or bullet of the body, after the title and any heading, states why the change exists: the symptom being fixed or the real root cause (awaiting exit before stdout drained). A `## Summary` heading or bullet format does not by itself fail. Fail if the body opens with a file-by-file or function-by-function list of edits, or with the disproved theory.
