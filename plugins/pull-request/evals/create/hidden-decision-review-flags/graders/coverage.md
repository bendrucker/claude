---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line. Pass when the body carries every point below, or all but one. A point counts in any wording and any form: a sentence, a list item, a table row, or a code block. Fail when two or more points are missing. Length, headings, and style do not matter here.

- Any document can now take flags, with the pattern assigned later
- Annotations are read from the feedback index because annotate --json omits them
- Quotes are rendered text, so locate maps them back to raw offsets
- A quote that appears twice is left unlocated rather than guessed
- The command was tried end to end on a real draft
