---
type: regex
target: trace
pattern: 'payout cache:(?: [0-9a-f]{8}){1} 5f2a413b\b'
---
Tied totals keep first-seen order, as the legacy stable sort does, which `bin/payout` relies on for the top row. The test preload prints one token per input class after the test summary, and this position holds the oracle's token for the class.
