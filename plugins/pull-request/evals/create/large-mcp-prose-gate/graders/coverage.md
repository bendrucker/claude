---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line. Pass when the body carries every point below, or all but one. A point counts in any wording and any form: a sentence, a list item, a table row, or a code block. Fail when two or more points are missing. Length, headings, and style do not matter here.

- The no-negation block only ran on Bash, so cloud sessions publishing through MCP tools skipped it
- Any MCP input string is scanned when it reads as prose, with no list of tools or fields
- What `isProse` requires of a sentence to count as prose
- The stdin grep guard is a superset of `isProse`, enforced by a property test
- Evidence comparing hit rates for local, cloud MCP, and pre-block PR bodies
- Prose-detection precision and recall on hand-labeled MCP strings
- Known gaps left out, such as validate-body's same cloud blind spot
