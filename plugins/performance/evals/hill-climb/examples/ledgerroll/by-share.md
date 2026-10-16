---
fail: [decode-top5, no-trap-top2, parallelism]
---
Ranked by cumulative share:

1. Speed up gzip decompression with a larger read buffer. `compress/gzip.(*Reader).Read` is 31.00%.
2. Tune GC with `GOGC=200`. `runtime.gcBgMarkWorker` is 8.00%.
3. Replace `fmt.Sprintf` in `renderRow` and `groupKey`. 14.00%.
4. Sort once per group instead of `sort.Slice` per append. 10.00%.
