---
fail: [no-trap-top2]
---
| # | Candidate | Targets |
| --- | --- | ---: |
| **1** | Shard the `Stats` mutex so `Inc` stops contending | 0.49% |
| **2** | Replace the linear scan in `dedupe` with a map | `main.dedupe` 43.90% |
| **3** | Hoist the `regexp.MustCompile` calls | 24.15% |

- Running `fanOut` concurrently is set aside: the run is CPU-bound.
