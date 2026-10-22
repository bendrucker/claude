---
fail: []
---
<issue>
---
title: Load bulk-export CSV directly instead of converting it to NDJSON
type: refactor
labels: [ingest, performance]
---

The transform step converts every bulk-export CSV page to NDJSON, and on the largest tenants it dominates the nightly run. The conversion adds no types, since `read_csv_page` yields strings, and the warehouse [`COPY`](https://docs.example-warehouse.com/sql/copy#csv-format) already takes CSV with a header row. Load bulk-export objects as CSV and skip `convert_page` for them. REST objects keep their JSON path.

| Tenant | Transform share of wall clock |
|---|---|
| Acme | 78% |
| Globex | 76% |
| Initech | 12.5% |

Bulk-export objects carry 99.5% of bytes, so the gain lands on the largest tenants: Acme should drop from 6.5 hours to about 1.5.

## Validation

Staging is about 1000x smaller than Acme, so compare per-GB transform and load rates against the current baseline rather than wall clock. Both paths run locally against the docker compose stack in `dev/`.

## 🤖 Agent Context

- `convert_page` in `ingest/transform.py` does the CSV to NDJSON conversion
- `load_ndjson` in `ingest/loader.py`; `COPY` accepts `FORMAT csv HEADER`
- `ObjectSpec.method` in `ingest/objects.py` separates bulk from REST
</issue>
