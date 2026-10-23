---
fail: []
---
samply failed on the shipped binary because of its hardened runtime, so I profiled an ad-hoc-signed copy.

1. `rle_encode` (74.5%): rescans the run so far for every byte it extends.
2. `crc_tile` (24.6%): bitwise CRC.
