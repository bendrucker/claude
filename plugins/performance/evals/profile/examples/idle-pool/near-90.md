---
fail: []
---
The six pool workers sit idle in `pthread_cond_wait` and never receive work, so all the CPU is on the main thread.

1. Parallelize the image loop across the idle pool: `decode_block` 88.9%, `checksum` 9.6%.
2. Defer the modulo reductions in `checksum`: 9.6%.
