-- Imports one file: getvariable('source_path') for getvariable('host'), with the
-- scanned stat carried in source_mtime/source_size. Runs once per changed file.
-- Deleting and re-inserting exactly the file's rows (instead of rewriting the whole
-- table) keeps freed blocks reusable after the CHECKPOINT that ends the import run,
-- so the database file stays proportional to the corpus.
BEGIN;

DELETE FROM raw
WHERE host = getvariable('host')
  AND source_file = getvariable('source_path');

-- ROW_NUMBER() OVER () with no ORDER BY relies on the scan preserving file order.
-- A single-file scan holds that in practice, but it is formally undefined; and
-- ignore_errors skips unparseable lines, so source_line can trail the physical
-- line number in files with malformed lines.
--
-- The projected columns come from pinned_columns (00_pinned.sql), which db.ts also
-- applies to rows already in the table, so an edit there reaches the whole corpus
-- without re-reading a file.
INSERT INTO raw
SELECT
  getvariable('host')                                 AS host,
  UNNEST(pinned_columns(json)),
  filename                                            AS source_file,
  ROW_NUMBER() OVER ()                                AS source_line,
  json                                                AS data
FROM read_json_objects(
  getvariable('source_path'),
  format='newline_delimited',
  ignore_errors=true,
  filename=true
);

DELETE FROM indexed_files
WHERE host = getvariable('host')
  AND path = getvariable('source_path');

INSERT INTO indexed_files
VALUES (
  getvariable('host'),
  getvariable('source_path'),
  TRY_CAST(getvariable('source_mtime') AS BIGINT),
  TRY_CAST(getvariable('source_size')  AS BIGINT)
);

COMMIT;
