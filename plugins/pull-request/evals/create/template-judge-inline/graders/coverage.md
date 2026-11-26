---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line. Pass when the body carries every point below, or all but one. A point counts in any wording and any form: a sentence, a list item, a table row, or a code block. Fail when two or more points are missing. Length, headings, and style do not matter here.

- The Workflow tool only loads a scriptPath from the session's working directories, which broke the audit
- The skill now passes the script text inline
- The script's comments were dropped since each run copies it into the tool call
- A one-shard audit ran end to end
