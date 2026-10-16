---
type: llm
---
Judge only the PR body. Ignore any text before the `Title:` line, the title line itself, and a final line that holds only a link (such as `Original Task: <url>`). Pass when what remains is made of short blocks, in paragraphs or bullets, and leads with why the backoff changed. A list or a heading as such does not fail. Fail when the body opens with a file-by-file change list or splits into reflexive Changes, Testing, or Summary sections.
