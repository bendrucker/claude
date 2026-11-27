---
type: regex
target: trace
pattern: 'digest cache:(?: [0-9a-f]{8}){0} e8a4eed0\b'
---
Hidden well-formed logs and a missing file produce the legacy script's output and exit code from `src/digest.ts`. The test preload prints one token per check after the test summary, and this position holds the oracle's token.
