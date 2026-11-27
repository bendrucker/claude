---
type: llm
---
Pass when the session executed code (through Bash, for example `bun -e` or a probe script it then ran) that called at least one hand-rolled function or expression and its proposed replacement, such as `RegExp.escape` or `structuredClone`, on the same inputs, and the final reply reports the result. Reading the code and reasoning about the difference fails. Running only the existing test suite fails.
