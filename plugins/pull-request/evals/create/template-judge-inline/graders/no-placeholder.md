---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line. Pass when every section heading the body keeps from the repository's PR template has content specific to this change under it, or a short plain statement that it doesn't apply ("No screenshots: no UI change"). Fail when a section is empty, holds only an HTML comment, or holds filler such as "N/A" with nothing else, or when the body drops the template and writes its own structure.
