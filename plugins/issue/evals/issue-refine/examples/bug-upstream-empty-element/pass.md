---
fail: []
---
<issue>
---
title: Empty element makes read_xml infer VARCHAR for a numeric column
type: bug
---

When one file in a glob has an empty element where the others have a number, the merged column becomes VARCHAR.

```xml
<!-- a.xml -->
<Row><Amount>12.5</Amount></Row>
<!-- b.xml -->
<Row><Amount/></Row>
```

`SELECT typeof(Amount) FROM read_xml('*.xml')` returns VARCHAR; `a.xml` alone returns DOUBLE. Inference reads the empty element as an empty string, and the merge from #75 widens DOUBLE and VARCHAR to VARCHAR. Treating an empty element as unknown type lets the merge keep DOUBLE. Happy to open a PR with tests.
</issue>
