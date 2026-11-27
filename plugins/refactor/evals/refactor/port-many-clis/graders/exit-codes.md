---
type: regex
target: trace
pattern: 'league cache:(?: [0-9a-f]{8}){1} 77406e03\b'
---
`bin/verify.ts` keeps its exit codes: 2 when called without a file, which `scripts/nightly.sh` reads as "no cup log", 3 on a problem, and 0 when clean. The test preload prints one token per check after the test summary, and this position holds the oracle's token.
