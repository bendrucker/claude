---
fail: [no-ranked-options, option-menu]
---
<issue>
---
title: Measure what consolidating connector metadata files would save
type: spike
---

The warehouse reads about 9,000 tiny metadata files. Compare layouts.

## Candidate Options

1. NDJSON per table
2. Parquet
3. Merge on read
</issue>
