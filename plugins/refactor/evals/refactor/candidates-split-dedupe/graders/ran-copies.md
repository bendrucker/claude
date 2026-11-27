---
type: llm
---
Pass when the session executed code (through Bash, for example `bun -e` or a probe script it then ran) that called at least two of the email normalization copies (`normalizeEmail`, `canonicalEmail`, `customerKey`, or the exported functions that wrap them) on the same inputs, and the final reply reports where they disagree. Reading the code and reasoning about the difference fails. Running only the existing test suite fails.
