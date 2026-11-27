---
type: llm
focus: last_message
---
The `quote` copy in `src/routes/match.ts` leaves `|` unescaped, so a path segment containing `|` becomes an alternation, and `RegExp.escape` changes what that route matches. Pass when the final reply states this difference: that the `match.ts` copy misses `|` (or its regex matches differently from `RegExp.escape` on input with `|`). Fail when the reply calls the three copies identical or never mentions the `|` gap.
