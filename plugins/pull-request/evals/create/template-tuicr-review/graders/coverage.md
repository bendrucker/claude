---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line. Pass when the body carries every point below, or all but one. A point counts in any wording and any form: a sentence, a list item, a table row, or a code block. Fail when two or more points are missing. Length, headings, and style do not matter here.

- Rex previously had only the Plannotator browser gate
- The skill opens tuicr and reads its comments after it exits, since Rex can't type comments back
- Only comments new since the last round count, as tuicr's upstream skill does
- Tested live in Rex
