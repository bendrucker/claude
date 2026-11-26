---
type: regex
target: trace
pattern: 'league cache:(?: [0-9a-f]{8}){4} dabd6646\b'
---
`scripts/weekly.sh` prints the same digest as before. It reads `--k` and `--max-age` from `config/league.conf`, whose CRLF line endings leave a carriage return on each value: `Number()` in the loose parser trims it, and the strict `int` rejects it, which only shows when the script runs. The test preload prints one token per check after the test summary, and this position holds the oracle's token.
