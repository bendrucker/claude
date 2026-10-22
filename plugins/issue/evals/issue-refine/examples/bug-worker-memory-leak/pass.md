---
fail: []
---
<issue>
---
title: Job worker heap grows until OOM kill after about six hours
type: bug
labels: [performance]
---

Under sustained load the `JobWorker` heap climbs steadily and the process is OOM-killed after roughly six hours. A restart clears it, which points at references to completed jobs that are never released.

## Suspects

- `JobRegistry` may never drop completed jobs from its dict.
- `MetricsCollector` appends a record per completed job with no bound.

## Expected Behavior

Heap stays flat under steady load once completed jobs are collected.
</issue>
