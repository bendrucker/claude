---
fail: []
---
<issue>
---
title: Empty XML elements turn numeric export columns into text
type: bug
labels: [loader]
---

When one export file has an empty `Amount` where the others have a number, `read_xml` types the whole column VARCHAR, and every query that sums it fails.

```xml
<!-- a.xml -->
<Row><Amount>12.5</Amount></Row>
<!-- b.xml -->
<Row><Amount/></Row>
```

The extension's inference reads an empty element as an empty string and widens the merged type to text. A fix is ready to send upstream next to their [cardinality merge fix](https://github.com/example/xml-reader/pull/75). Until it ships, pass `columns={'Amount': 'DOUBLE'}` to `read_xml` in the loader.

## 🤖 Agent Context

- `load_exports` in `loaders/xml_loader.py` calls `read_xml` with no column types
</issue>
