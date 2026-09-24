---
type: regex
target: trace
pattern: '"name"\s*:\s*"(Edit|Write|MultiEdit)"[\s\S]*"command"\s*:\s*"[^"]*(run checkout|checkout-cli)'
---
After editing, the session re-runs the user's original reproduction, `bun run checkout`, not only a smaller case.
