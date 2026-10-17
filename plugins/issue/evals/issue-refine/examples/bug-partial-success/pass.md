---
fail: []
---
Drafted the issue and saved it to `tmp/issue-export-partial-success.md`.

<issue>
---
title: Nightly export reports success when object retrievals time out
type: bug
labels: [export]
priority: high
relations:
  related:
    - https://tracker.example.com/issue/TEAM-412
    - https://tracker.example.com/issue/TEAM-388
---

The nightly export marks its run successful even when per-object retrievals time out, so downstream jobs read a partial snapshot as if it were complete. The retry work in [Add retry with backoff](https://tracker.example.com/issue/TEAM-412) lowers how often this happens but leaves the status wrong when retries run out.

## Expected Behavior

The overall status is a failure, or a distinct partial status, whenever any object retrieval timed out.

## Cause

`SalesforceRetrieveService.retrieve` catches the timeout and logs it without returning a failed result. `ExportProcessorOrchestrator` keeps looping, and `ExportSummary` sets `overallSuccess` without reading per-object status.

## 🤖 Agent Context

Gathered at `a1b2c3d` on 2026-10-17.

### Related Code

- `overallSuccess` at `core/src/export/ExportSummary.java:140` ignores per-object status
- the retrieve loop at `core/src/export/ExportProcessorOrchestrator.java:200` swallows timeouts
- the catch at `core/src/export/SalesforceRetrieveService.java:250` logs and drops the timeout
</issue>
