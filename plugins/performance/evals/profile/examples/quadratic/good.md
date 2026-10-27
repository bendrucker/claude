---
fail: []
---
`_platform_memmove` is 76.8% of the run, all of it under `queue_pop`, which shifts the whole array to remove the front job, so draining is quadratic.

1. `queue_pop` memmove shift (77.0%): use a head index or ring buffer. At most 77% of the run, about 4.3x.
2. `run_job` (22.9%).
