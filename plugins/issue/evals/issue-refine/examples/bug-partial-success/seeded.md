---
fail: [bare-ref, raw-url, related-section, line-numbers, heading-antithesis, title-length, title-parenthetical, title-sentence-case, relations]
---
<issue>
---
title: Nightly Export Reports Success On Timeouts (Partial Snapshot Consumed Downstream)
type: bug
---

The nightly export reports success even when object retrievals time out. See TEAM-412 and MR !578.

## Report Partial, Never Guess

`overallSuccess` is set in `core/src/export/ExportSummary.java:140-145` without reading per-object status.

## Related Issues

- https://tracker.example.com/issue/TEAM-412
</issue>
