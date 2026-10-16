---
fail: [gap, profile, no-trap-top2]
---
Ranked by share of the CPU profile:

1. **Replace `encoding/json.Marshal` with a hand-written encoder** for `Record` (34.63% cum).
2. **Swap `crc32.ChecksumIEEE` for a table-driven Castagnoli checksum** (13.17%).
3. **Avoid `strings.ToLower` in `normalize`** (11.71%).
