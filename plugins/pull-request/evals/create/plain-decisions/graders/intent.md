---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line, such as a note that the push or create command failed. Pass when the body for this personal repo is made of short blocks, in paragraphs or bullets. A list or a heading as such does not fail. Fail when it opens with a file-by-file change list or splits into reflexive Changes, Testing, or Summary sections.
