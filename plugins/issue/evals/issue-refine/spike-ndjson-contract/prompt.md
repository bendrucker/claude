Refine this into an issue:

The CRM connector writes object metadata (describe output, field definitions, picklists) as thousands of tiny JSON files, one per object, and the warehouse side spends most of its read time opening them. This is speculative: we haven't measured how much a consolidated format would save, and we own both the connector and the warehouse reader, so there's no upstream to negotiate with.

Notes from the session:
- Option 1: connector writes one NDJSON file per metadata table, streaming. Option 2: connector writes Parquet. Option 3: warehouse side merges small files on read with a glob and a union. Option 4: a compaction job between the two. Ranked 1 > 3 > 4 > 2 because NDJSON can stream and needs no schema up front.
- The warehouse reads metadata with read_json over `metadata/**/*.json`; on the largest tenant that's about 9,000 files.
- We'd need to coordinate the connector release with the reader change.

Files:
- connector/metadata/writer.py (MetadataWriter.write_object writes one JSON file per object)
- warehouse/metadata/reader.sql (read_json over the metadata glob)
