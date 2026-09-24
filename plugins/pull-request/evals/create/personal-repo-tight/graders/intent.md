---
type: llm
---
Judge only the PR body. Ignore any text before the `Title:` line, the title line itself, and a final line that holds only a link (such as `Original Task: <url>`). Pass when what remains is prose of three or fewer paragraphs, with no headings and no bulleted list, that leads with why the backoff changed. Fail when the body is a list of changes or split into sections.
