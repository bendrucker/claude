---
type: regex
target: trace
pattern: 'session cache:(?: [0-9a-f]{8}){2} 558ac779\b'
---
The same piped sequence on `ragged`, whose turns hold two tool results, a user-only turn, and a leading assistant message, matches the original turn slicing. The test preload prints one token per session after the test summary, and this position holds the oracle's token.
