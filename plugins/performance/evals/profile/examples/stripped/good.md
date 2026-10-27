---
fail: []
---
The release binary is stripped, so I rebuilt it at -O2 with symbols and without strip.

1. `tone_map` (83.0%): two integer divisions per pixel.
2. `mix_rows` (16.4%).
