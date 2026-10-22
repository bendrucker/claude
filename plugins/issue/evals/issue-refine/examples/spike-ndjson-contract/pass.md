---
fail: []
---
<issue>
---
title: Measure what consolidating connector metadata files would save
type: spike
---

The connector writes one JSON file per object, and the warehouse reads about 9,000 of them on the largest tenant. Measure how much of that read time is per-file overhead, and whether one NDJSON file per metadata table, written streaming, would recover it. We own both sides.

## 🤖 Agent Context

- `MetadataWriter.write_object` in `connector/metadata/writer.py`
- `warehouse/metadata/reader.sql` reads `metadata/**/*.json`
</issue>
