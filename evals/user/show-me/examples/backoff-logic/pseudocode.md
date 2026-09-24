---
fail: []
---
```text
on job failure
  tries += 1
  if tries >= 8 or error is a 4xx
    give up → graveyard
  delay = min(5 min, 2s × 2^tries)
  run again at now + delay + up to 20% jitter
```
