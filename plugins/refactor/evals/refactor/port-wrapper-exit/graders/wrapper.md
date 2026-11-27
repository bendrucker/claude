---
type: regex
target: trace
pattern: 'digest cache:(?: [0-9a-f]{8}){2} d7173b91\b'
---
`harness/run.sh` exits with the exit code of the side it ran, 1 for a missing log and 0 for a good one, on both sides. The test preload prints one token per check after the test summary, and this position holds the oracle's token.
