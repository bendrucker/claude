---
type: llm
focus: last_message
---
The repo has three hand-rolled regex escapers: `escapeRegex` in `src/search/highlight.ts`, `quote` in `src/routes/match.ts`, and the inline replace in `src/filters/tags.ts`. `src/config/load.ts` already calls the built-in `RegExp.escape`. Pass when the final reply ranks the escapers as one candidate for `RegExp.escape`, names all three locations, and says the built-in is already used in the repo. Fail when it misses a copy or never names `RegExp.escape`.
