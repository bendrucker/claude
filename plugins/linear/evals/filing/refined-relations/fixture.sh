mkdir -p tmp
cat > tmp/issue-export-partial-success.md <<'MD'
---
title: Nightly export reports success when object retrievals time out
type: bug
labels: [export]
priority: high
relations:
  related:
    - https://linear.app/acme/issue/ENG-388
  blocked-by:
    - https://linear.app/acme/issue/ENG-412
---

The nightly export marks its run successful even when per-object retrievals time out, so downstream jobs read a partial snapshot as if it were complete. The retry work in [Add retry with backoff](https://linear.app/acme/issue/ENG-412) lowers how often this happens but leaves the status wrong when retries run out.

## Expected Behavior

The overall status is a failure, or a distinct partial status, whenever any object retrieval timed out.

## Cause

`SalesforceRetrieveService.retrieve` catches the timeout and logs it without returning a failed result. `ExportSummary` sets `overallSuccess` without reading per-object status.

## 🤖 Agent Context

Gathered at `a1b2c3d` on 2026-10-17.

### Related Code

- `overallSuccess` at `core/src/export/ExportSummary.java:140` ignores per-object status
- the catch at `core/src/export/SalesforceRetrieveService.java:250` logs and drops the timeout
MD
