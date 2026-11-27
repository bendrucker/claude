---
type: regex
target: trace
pattern: 'digest cache:(?: [0-9a-f]{8}){1} 06d0639b\b'
---
Hidden logs with a header row, an extra field, or a malformed amount exit 0 from `src/digest.ts`, as the legacy script does when it skips such a line. The port exited 2, and the signed-off `exit N` exemption hid it. The test preload prints one token per check after the test summary, and this position holds the oracle's token.
