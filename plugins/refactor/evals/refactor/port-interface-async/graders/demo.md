---
type: regex
target: trace
pattern: 'session cache:(?: [0-9a-f]{8}){0} 71eaa5ec\b'
---
Piping three questions into `src/repl.ts` for `demo`, then a fourth in a second run, builds each prompt from the history the previous line wrote, as the synchronous original does. The test preload prints one token per session after the test summary, and this position holds the oracle's token.
