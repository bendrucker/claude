---
fail: [no-leak]
---
<issue>
---
title: Empty XML elements turn numeric export columns into text
type: bug
---

`<Amount/>` in one file types `Amount` as VARCHAR. Pass explicit `columns` to `read_xml` until the patch on my Studio ships upstream.

## 🤖 Agent Context

- Traces in tmp/climb/noise-3/traces/
</issue>
