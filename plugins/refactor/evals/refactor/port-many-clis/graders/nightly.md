---
type: regex
target: trace
pattern: 'league cache:(?: [0-9a-f]{8}){3} f75f7d42\b'
---
`scripts/nightly.sh` prints the same report and exit status as before. It passes camelCase flags (`--maxGap`, `--keepLast`), an undefined option (`--quiet`), and an exponent number (`--start 1.5e3`), and relies on `bin/verify.ts` exiting 2 without a file. The test preload prints one token per check after the test summary, and this position holds the oracle's token.
