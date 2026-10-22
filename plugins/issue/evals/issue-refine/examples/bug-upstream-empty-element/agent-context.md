---
fail: [no-agent-context]
---
<issue>
---
title: Empty element makes read_xml infer VARCHAR for a numeric column
type: bug
---

`<Amount/>` in one file types the merged column VARCHAR.

## 🤖 Agent Context

- `InferElementType` in `src/xml_schema_inference.cpp`
</issue>
