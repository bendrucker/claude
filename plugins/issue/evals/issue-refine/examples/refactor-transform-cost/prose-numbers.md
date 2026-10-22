---
fail: [links-source, numbers-table]
---
<issue>
---
title: Load bulk-export CSV directly instead of converting it to NDJSON
type: refactor
---

The transform step converts bulk-export CSV to NDJSON. Acme spends 78% of wall clock there, Globex 76%, Initech 12.5%, Umbrella 10%, and Hooli 7%. Load the CSV directly.

## Validation

Compare per-GB rates against the current baseline, locally with docker compose.
</issue>
