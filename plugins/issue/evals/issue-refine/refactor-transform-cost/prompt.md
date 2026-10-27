Refine this into an issue:

The nightly ingest pipeline spends most of its time in the transform step, which converts the vendor's gzipped CSV exports into gzipped NDJSON before loading. The conversion adds no type information: `read_csv_page` yields every value as a string, so `json.dumps` writes strings back out. The warehouse loader already accepts CSV with a header row, so we can load the CSV directly and skip the transform for bulk-export objects.

Investigation notes:
- Largest tenant (Acme): the transform used 19.2 of 20.4 worker-hours, 78% of a 6.5-hour wall clock. The payload grows from 58.2 GB of CSV to 70.4 GB of NDJSON.
- Bulk-export objects: 267 objects carrying 57.9 GB (99.5% of bytes). REST objects: 1,540 objects carrying 0.3 GB. REST objects arrive as JSON already and keep their path.
- Transform share of wall clock by tenant: Acme 78%, Globex 76%, Initech 12.5%, Umbrella 10%, Hooli 7%. The share tracks record volume, not object count.
- Projected Acme wall clock without the conversion: about 1.5 hours.
- The staging tenant is about 1000x smaller than Acme, so a before/after wall clock there won't predict Acme. Compare per-GB transform and load rates against the current baseline instead.
- Both paths can be validated locally with the docker compose stack in `dev/`, which runs the loader against a local warehouse.

Files:
- ingest/transform.py (convert_page reads with read_csv_page and writes NDJSON with json.dumps)
- ingest/loader.py (load_ndjson; the warehouse COPY also takes FORMAT csv HEADER)
- ingest/objects.py (ObjectSpec.method is "bulk" or "rest")

Sources:
- Warehouse COPY reference, CSV options: https://docs.example-warehouse.com/sql/copy#csv-format
- Nightly run dashboard for Acme: https://grafana.example.com/d/ingest-nightly?var-tenant=acme
