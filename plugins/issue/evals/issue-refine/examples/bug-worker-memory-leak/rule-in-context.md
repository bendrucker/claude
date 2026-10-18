---
fail: []
---
<issue>
---
title: Job worker heap grows until OOM kill after about six hours
type: bug
---

Under sustained load the `JobWorker` heap climbs steadily and the process is OOM-killed after roughly six hours. A restart clears it, which points at references to completed jobs that are never released.

## Expected Behavior

Heap stays flat under steady load once completed jobs are collected.

## 🤖 Agent Context

- `JobRegistry.complete` in `worker/registry.py` never deletes the entry

---

- `worker/registry.py:88-94` holds the dict, see #412 and TEAM-412
</issue>
